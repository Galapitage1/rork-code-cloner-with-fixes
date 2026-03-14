<?php
error_reporting(0);
ini_set('display_errors', '0');

function ue_send_cors(string $methods = 'GET, POST, OPTIONS'): void {
    header('Access-Control-Allow-Origin: *');
    header('Access-Control-Allow-Methods: ' . $methods);
    header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Uber-Signature');
}

function ue_preflight(string $methods = 'GET, POST, OPTIONS'): void {
    ue_send_cors($methods);
    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
}

function ue_respond($data, int $status = 200): void {
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

function ue_data_dir(): string {
    $dir = __DIR__ . '/../data';
    if (!is_dir($dir)) {
        @mkdir($dir, 0755, true);
    }
    return $dir;
}

function ue_read_json(string $filename, $default = []) {
    $path = ue_data_dir() . '/' . $filename;
    if (!file_exists($path)) {
        return $default;
    }
    $raw = @file_get_contents($path);
    if ($raw === false || $raw === '') {
        return $default;
    }
    $decoded = json_decode($raw, true);
    return is_array($decoded) ? $decoded : $default;
}

function ue_write_json(string $filename, $data): bool {
    $path = ue_data_dir() . '/' . $filename;
    $encoded = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
    if ($encoded === false) {
        return false;
    }
    $result = @file_put_contents($path, $encoded, LOCK_EX);
    if ($result === false) {
        return false;
    }
    @chmod($path, 0644);
    return true;
}

function ue_now_ms(): int {
    return (int) floor(microtime(true) * 1000);
}

function ue_trim($value, int $maxLen = 500): string {
    $text = is_string($value) ? trim($value) : '';
    if ($text === '') {
        return '';
    }
    if (function_exists('mb_substr')) {
        return mb_substr($text, 0, $maxLen);
    }
    return substr($text, 0, $maxLen);
}

function ue_is_assoc(array $value): bool {
    return array_keys($value) !== range(0, count($value) - 1);
}

function ue_latest_active_record($raw): array {
    if (!is_array($raw)) {
        return [];
    }

    $records = [];
    if (ue_is_assoc($raw)) {
        $records[] = $raw;
    } else {
        foreach ($raw as $item) {
            if (is_array($item)) {
                $records[] = $item;
            }
        }
    }

    if (!$records) {
        return [];
    }

    $active = array_values(array_filter($records, function ($item) {
        return !(isset($item['deleted']) && $item['deleted'] === true);
    }));
    $candidates = $active ?: $records;

    usort($candidates, function ($a, $b) {
        $aUpdated = isset($a['updatedAt']) && is_numeric($a['updatedAt']) ? (int)$a['updatedAt'] : 0;
        $bUpdated = isset($b['updatedAt']) && is_numeric($b['updatedAt']) ? (int)$b['updatedAt'] : 0;
        return $bUpdated <=> $aUpdated;
    });

    return is_array($candidates[0]) ? $candidates[0] : [];
}

function ue_load_campaign_settings(): array {
    $settings = ue_latest_active_record(ue_read_json('campaign_settings.json', []));
    $outletConfigsRaw = is_array($settings['uberEatsOutletConfigs'] ?? null) ? $settings['uberEatsOutletConfigs'] : [];
    $outletConfigs = [];

    foreach ($outletConfigsRaw as $key => $config) {
        if (!is_array($config)) {
            continue;
        }
        $outletName = ue_trim($config['outletName'] ?? $key, 160);
        $storeId = ue_trim($config['storeId'] ?? '', 180);
        if ($outletName === '') {
            continue;
        }
        $outletConfigs[$outletName] = [
            'outletName' => $outletName,
            'storeId' => $storeId,
            'storeName' => ue_trim($config['storeName'] ?? '', 220),
        ];
    }

    return [
        'clientId' => ue_trim($settings['uberEatsClientId'] ?? '', 220),
        'clientSecret' => ue_trim($settings['uberEatsClientSecret'] ?? '', 260),
        'outletConfigs' => $outletConfigs,
    ];
}

function ue_http_request(string $url, string $method = 'GET', array $headers = [], $body = null, bool $isForm = false): array {
    if (!function_exists('curl_init')) {
        return ['ok' => false, 'status' => 0, 'body' => '', 'json' => null, 'error' => 'cURL is not available'];
    }

    $ch = curl_init($url);
    if ($ch === false) {
        return ['ok' => false, 'status' => 0, 'body' => '', 'json' => null, 'error' => 'Failed to initialize HTTP client'];
    }

    $normalizedHeaders = $headers;
    if ($isForm) {
        $normalizedHeaders[] = 'Content-Type: application/x-www-form-urlencoded';
    } else {
        $normalizedHeaders[] = 'Accept: application/json';
    }

    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_CONNECTTIMEOUT => 20,
        CURLOPT_TIMEOUT => 60,
        CURLOPT_FOLLOWLOCATION => true,
        CURLOPT_HTTPHEADER => $normalizedHeaders,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
        CURLOPT_CUSTOMREQUEST => strtoupper($method),
    ]);

    if ($body !== null) {
        if ($isForm && is_array($body)) {
            curl_setopt($ch, CURLOPT_POSTFIELDS, http_build_query($body, '', '&', PHP_QUERY_RFC3986));
        } elseif (is_array($body)) {
            $normalizedHeaders[] = 'Content-Type: application/json';
            curl_setopt($ch, CURLOPT_HTTPHEADER, $normalizedHeaders);
            curl_setopt($ch, CURLOPT_POSTFIELDS, json_encode($body, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
        } else {
            curl_setopt($ch, CURLOPT_POSTFIELDS, (string)$body);
        }
    }

    $raw = curl_exec($ch);
    $error = curl_error($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    if ($raw === false) {
        return ['ok' => false, 'status' => $status, 'body' => '', 'json' => null, 'error' => ($error !== '' ? $error : 'Request failed')];
    }

    $decoded = json_decode((string)$raw, true);
    return [
        'ok' => $status >= 200 && $status < 300,
        'status' => $status,
        'body' => (string)$raw,
        'json' => is_array($decoded) ? $decoded : null,
        'error' => ($status >= 200 && $status < 300) ? '' : ('HTTP ' . $status),
    ];
}

function ue_get_access_token(array $config): array {
    $clientId = ue_trim($config['clientId'] ?? '', 220);
    $clientSecret = ue_trim($config['clientSecret'] ?? '', 260);
    if ($clientId === '' || $clientSecret === '') {
        return ['success' => false, 'error' => 'Missing Uber Eats client ID or client secret'];
    }

    $response = ue_http_request(
        'https://login.uber.com/oauth/v2/token',
        'POST',
        [],
        [
            'client_id' => $clientId,
            'client_secret' => $clientSecret,
            'grant_type' => 'client_credentials',
            'scope' => 'eats.store eats.order eats.store.orders.read',
        ],
        true
    );

    if (!$response['ok']) {
        $message = is_array($response['json']) ? ue_trim($response['json']['message'] ?? $response['json']['error'] ?? '', 300) : '';
        return ['success' => false, 'error' => ($message !== '' ? $message : ($response['error'] ?: 'Failed to get OAuth token'))];
    }

    $payload = is_array($response['json']) ? $response['json'] : [];
    $token = ue_trim($payload['access_token'] ?? '', 2000);
    if ($token === '') {
        return ['success' => false, 'error' => 'Uber OAuth response did not include an access token'];
    }

    return ['success' => true, 'token' => $token];
}

function ue_authorized_get(string $url, string $token): array {
    return ue_http_request($url, 'GET', ['Authorization: Bearer ' . $token]);
}

function ue_list_stores(string $token): array {
    $response = ue_authorized_get('https://api.uber.com/v1/eats/stores', $token);
    if (!$response['ok']) {
        return ['success' => false, 'error' => $response['error'] ?: 'Failed to load stores'];
    }
    $payload = is_array($response['json']) ? $response['json'] : [];
    $stores = [];
    foreach (($payload['stores'] ?? []) as $row) {
        if (!is_array($row)) {
            continue;
        }
        $stores[] = [
            'id' => ue_trim($row['id'] ?? '', 180),
            'name' => ue_trim($row['name'] ?? '', 220),
        ];
    }
    return ['success' => true, 'stores' => $stores];
}

function ue_fetch_created_orders(string $storeId, string $token): array {
    $url = 'https://api.uber.com/v1/eats/stores/' . rawurlencode($storeId) . '/created-orders';
    $response = ue_authorized_get($url, $token);
    if (!$response['ok']) {
        return ['success' => false, 'error' => $response['error'] ?: 'Failed to fetch created orders'];
    }
    return ['success' => true, 'payload' => is_array($response['json']) ? $response['json'] : []];
}

function ue_extract_created_order_ids(array $payload): array {
    $ids = [];
    $sources = [];
    if (isset($payload['orders']) && is_array($payload['orders'])) {
        $sources = $payload['orders'];
    } elseif (isset($payload['data']) && is_array($payload['data'])) {
        $sources = $payload['data'];
    }

    foreach ($sources as $row) {
        if (!is_array($row)) {
            continue;
        }
        $id = ue_trim($row['id'] ?? $row['order_id'] ?? '', 180);
        if ($id !== '') {
            $ids[] = $id;
        }
    }

    return array_values(array_unique($ids));
}

function ue_fetch_order_detail(string $orderId, string $token): array {
    $url = 'https://api.uber.com/v2/eats/order/' . rawurlencode($orderId);
    $response = ue_authorized_get($url, $token);
    if (!$response['ok']) {
        return ['success' => false, 'error' => $response['error'] ?: 'Failed to fetch order detail'];
    }
    return ['success' => true, 'payload' => is_array($response['json']) ? $response['json'] : []];
}

function ue_parse_iso_datetime(string $value): array {
    $trimmed = ue_trim($value, 120);
    if ($trimmed === '') {
        return ['date' => '', 'time' => ''];
    }
    $timestamp = strtotime($trimmed);
    if ($timestamp === false) {
        return ['date' => '', 'time' => ''];
    }
    return [
        'date' => gmdate('Y-m-d', $timestamp),
        'time' => gmdate('H:i', $timestamp),
    ];
}

function ue_parse_money_amount($value): ?float {
    if (is_numeric($value)) {
        return round((float)$value, 2);
    }
    if (is_array($value)) {
        if (isset($value['amount']) && is_numeric($value['amount'])) {
            return round((float)$value['amount'], 2);
        }
        if (isset($value['value']) && is_numeric($value['value'])) {
            return round((float)$value['value'], 2);
        }
        if (isset($value['display_amount']) && is_numeric($value['display_amount'])) {
            return round((float)$value['display_amount'], 2);
        }
    }
    return null;
}

function ue_amount_from_paths(array $payload, array $paths): ?float {
    foreach ($paths as $path) {
        $cursor = $payload;
        foreach ($path as $segment) {
            if (!is_array($cursor) || !array_key_exists($segment, $cursor)) {
                $cursor = null;
                break;
            }
            $cursor = $cursor[$segment];
        }
        $amount = ue_parse_money_amount($cursor);
        if ($amount !== null) {
            return $amount;
        }
    }
    return null;
}

function ue_find_outlet_name_for_store(string $storeId, array $config): string {
    if ($storeId === '') {
        return '';
    }
    foreach (($config['outletConfigs'] ?? []) as $row) {
        if (!is_array($row)) {
            continue;
        }
        if (ue_trim($row['storeId'] ?? '', 180) === $storeId) {
            return ue_trim($row['outletName'] ?? '', 160);
        }
    }
    return '';
}

function ue_normalize_order(array $payload, array $config, string $createdBy = 'ubereats_api'): array {
    $orderId = ue_trim($payload['id'] ?? $payload['order_id'] ?? '', 180);
    $displayId = ue_trim($payload['display_id'] ?? $payload['displayId'] ?? '', 120);
    $storeId = ue_trim($payload['store_id'] ?? ($payload['store']['id'] ?? ''), 180);
    $storeName = ue_trim($payload['store_name'] ?? ($payload['store']['name'] ?? ''), 220);
    $currentState = ue_trim($payload['current_state'] ?? $payload['status'] ?? '', 120);
    $fulfillmentType = ue_trim($payload['fulfillment_type'] ?? ($payload['type'] ?? ''), 120);
    $placedAt = ue_trim($payload['placed_at'] ?? $payload['created_time'] ?? '', 120);
    $scheduledAt = ue_trim($payload['scheduled_at'] ?? '', 120);
    $placedDateTime = ue_parse_iso_datetime($placedAt);
    $orderDate = $placedDateTime['date'] !== '' ? $placedDateTime['date'] : gmdate('Y-m-d');
    $orderTime = $placedDateTime['time'] !== '' ? $placedDateTime['time'] : gmdate('H:i');

    $eater = is_array($payload['eater'] ?? null) ? $payload['eater'] : [];
    $delivery = is_array($payload['delivery'] ?? null) ? $payload['delivery'] : [];
    $location = is_array($delivery['location'] ?? null) ? $delivery['location'] : [];
    $address = is_array($location['address'] ?? null) ? $location['address'] : [];

    $customerName = trim(ue_trim($eater['first_name'] ?? '', 80) . ' ' . ue_trim($eater['last_name'] ?? '', 80));
    if ($customerName === '') {
        $customerName = ue_trim($eater['name'] ?? '', 160);
    }

    $addressParts = array_values(array_filter([
        ue_trim($address['street_address_1'] ?? '', 180),
        ue_trim($address['street_address_2'] ?? '', 180),
        ue_trim($address['city'] ?? '', 120),
    ], function ($value) {
        return $value !== '';
    }));

    $items = [];
    $cart = is_array($payload['cart'] ?? null) ? $payload['cart'] : [];
    foreach (($cart['items'] ?? []) as $row) {
        if (!is_array($row)) {
            continue;
        }
        $customizations = [];
        foreach (($row['selected_modifier_groups'] ?? []) as $group) {
            if (!is_array($group)) {
                continue;
            }
            foreach (($group['selected_items'] ?? []) as $selected) {
                if (!is_array($selected)) {
                    continue;
                }
                $label = ue_trim($selected['title'] ?? '', 180);
                if ($label !== '') {
                    $customizations[] = $label;
                }
            }
        }

        $items[] = [
            'id' => ue_trim($row['id'] ?? '', 180),
            'title' => ue_trim($row['title'] ?? 'Item', 220),
            'quantity' => isset($row['quantity']) && is_numeric($row['quantity']) ? (int)$row['quantity'] : 0,
            'price' => ue_parse_money_amount($row['price'] ?? null),
            'customizations' => $customizations,
            'specialInstructions' => ue_trim($row['special_instructions'] ?? '', 300),
        ];
    }

    $updatedAt = ue_now_ms();
    return [
        'id' => $orderId !== '' ? $orderId : ('uber-order-' . $updatedAt),
        'displayId' => $displayId,
        'storeId' => $storeId,
        'storeName' => $storeName,
        'outletName' => ue_find_outlet_name_for_store($storeId, $config),
        'currentState' => $currentState,
        'fulfillmentType' => $fulfillmentType,
        'orderDate' => $orderDate,
        'orderTime' => $orderTime,
        'placedAt' => $placedAt,
        'scheduledAt' => $scheduledAt,
        'customerName' => $customerName,
        'customerPhone' => ue_trim($eater['phone_number'] ?? '', 60),
        'customerAddress' => implode(', ', $addressParts),
        'currency' => ue_trim($payload['currency_code'] ?? ($payload['currency']['code'] ?? ''), 12),
        'totalAmount' => ue_amount_from_paths($payload, [['payment', 'charges', 'total'], ['payment', 'total'], ['charges', 'total']]),
        'subtotalAmount' => ue_amount_from_paths($payload, [['payment', 'charges', 'subtotal'], ['charges', 'subtotal']]),
        'taxAmount' => ue_amount_from_paths($payload, [['payment', 'charges', 'tax'], ['charges', 'tax']]),
        'deliveryFee' => ue_amount_from_paths($payload, [['payment', 'charges', 'delivery_fee'], ['charges', 'delivery_fee']]),
        'items' => $items,
        'raw' => $payload,
        'createdAt' => $updatedAt,
        'updatedAt' => $updatedAt,
        'createdBy' => $createdBy,
    ];
}

function ue_save_orders(array $incoming): array {
    $existing = ue_read_json('uber_eats_orders.json', []);
    $rows = is_array($existing) ? $existing : [];
    $byId = [];

    foreach ($rows as $row) {
        if (is_array($row) && isset($row['id'])) {
            $byId[(string)$row['id']] = $row;
        }
    }

    foreach ($incoming as $row) {
        if (!is_array($row) || !isset($row['id'])) {
            continue;
        }
        $id = (string)$row['id'];
        $current = $byId[$id] ?? null;
        $currentUpdatedAt = is_array($current) && isset($current['updatedAt']) && is_numeric($current['updatedAt']) ? (int)$current['updatedAt'] : 0;
        $nextUpdatedAt = isset($row['updatedAt']) && is_numeric($row['updatedAt']) ? (int)$row['updatedAt'] : ue_now_ms();
        if ($current === null) {
            $byId[$id] = $row;
            continue;
        }
        if ($nextUpdatedAt >= $currentUpdatedAt) {
            $row['createdAt'] = $current['createdAt'] ?? $row['createdAt'] ?? $nextUpdatedAt;
            $byId[$id] = array_merge($current, $row);
        }
    }

    $merged = array_values($byId);
    usort($merged, function ($a, $b) {
        $aUpdated = isset($a['updatedAt']) && is_numeric($a['updatedAt']) ? (int)$a['updatedAt'] : 0;
        $bUpdated = isset($b['updatedAt']) && is_numeric($b['updatedAt']) ? (int)$b['updatedAt'] : 0;
        return $bUpdated <=> $aUpdated;
    });
    ue_write_json('uber_eats_orders.json', $merged);
    return $merged;
}

function ue_append_webhook_event(array $event): void {
    $rows = ue_read_json('uber_eats_webhook_events.json', []);
    if (!is_array($rows)) {
        $rows = [];
    }
    $rows[] = $event;
    if (count($rows) > 500) {
        $rows = array_slice($rows, -500);
    }
    ue_write_json('uber_eats_webhook_events.json', $rows);
}

function ue_extract_header(string $name): string {
    $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
    if (isset($_SERVER[$key])) {
        return trim((string)$_SERVER[$key]);
    }
    if (function_exists('getallheaders')) {
        $headers = getallheaders();
        foreach ($headers as $headerName => $value) {
            if (strtolower($headerName) === strtolower($name)) {
                return trim((string)$value);
            }
        }
    }
    return '';
}

function ue_verify_webhook_signature(string $rawBody, string $signatureHeader, string $clientSecret): bool {
    $signature = trim($signatureHeader);
    $secret = trim($clientSecret);
    if ($signature === '' || $secret === '') {
        return false;
    }

    $hex = hash_hmac('sha256', $rawBody, $secret);
    $base64 = base64_encode(hash_hmac('sha256', $rawBody, $secret, true));
    $candidates = [
        $hex,
        'sha256=' . $hex,
        $base64,
        'sha256=' . $base64,
    ];

    foreach ($candidates as $candidate) {
        if (hash_equals($candidate, $signature)) {
            return true;
        }
    }

    return false;
}

function ue_extract_order_id_from_webhook(array $payload): string {
    $meta = is_array($payload['meta'] ?? null) ? $payload['meta'] : [];
    $resourceHref = ue_trim($payload['resource_href'] ?? $meta['resource_href'] ?? '', 400);
    $resourceId = ue_trim($payload['resource_id'] ?? $meta['resource_id'] ?? '', 180);
    if ($resourceId !== '') {
        return $resourceId;
    }
    if ($resourceHref !== '' && preg_match('#/order/([^/?]+)#', $resourceHref, $matches)) {
        return ue_trim($matches[1], 180);
    }
    return '';
}

function ue_extract_store_id_from_payload(array $payload): string {
    $meta = is_array($payload['meta'] ?? null) ? $payload['meta'] : [];
    return ue_trim($payload['store_id'] ?? $meta['store_id'] ?? '', 180);
}

function ue_sync_single_order(string $orderId, array $config, string $createdBy = 'ubereats_sync'): array {
    if ($orderId === '') {
        return ['success' => false, 'error' => 'Missing order ID'];
    }

    $tokenData = ue_get_access_token($config);
    if (!($tokenData['success'] ?? false)) {
        return $tokenData;
    }

    $detail = ue_fetch_order_detail($orderId, (string)$tokenData['token']);
    if (!($detail['success'] ?? false)) {
        return $detail;
    }

    $normalized = ue_normalize_order(is_array($detail['payload'] ?? null) ? $detail['payload'] : [], $config, $createdBy);
    ue_save_orders([$normalized]);
    return ['success' => true, 'order' => $normalized];
}

function ue_sync_recent_orders(array $config, string $outletFilter = ''): array {
    $tokenData = ue_get_access_token($config);
    if (!($tokenData['success'] ?? false)) {
        return $tokenData;
    }
    $token = (string)$tokenData['token'];

    $selectedConfigs = [];
    foreach (($config['outletConfigs'] ?? []) as $row) {
        if (!is_array($row)) {
            continue;
        }
        $outletName = ue_trim($row['outletName'] ?? '', 160);
        $storeId = ue_trim($row['storeId'] ?? '', 180);
        if ($storeId === '') {
            continue;
        }
        if ($outletFilter !== '' && strcasecmp($outletFilter, $outletName) !== 0) {
            continue;
        }
        $selectedConfigs[] = $row;
    }

    if (!$selectedConfigs) {
        return ['success' => false, 'error' => 'No mapped Uber Eats store IDs found for the selected sales outlet(s)'];
    }

    $saved = [];
    $counts = [];
    foreach ($selectedConfigs as $row) {
        $storeId = ue_trim($row['storeId'] ?? '', 180);
        $outletName = ue_trim($row['outletName'] ?? '', 160);
        $created = ue_fetch_created_orders($storeId, $token);
        if (!($created['success'] ?? false)) {
            $counts[] = ['outletName' => $outletName, 'storeId' => $storeId, 'loaded' => 0, 'error' => ue_trim($created['error'] ?? 'Failed', 240)];
            continue;
        }

        $orderIds = ue_extract_created_order_ids(is_array($created['payload'] ?? null) ? $created['payload'] : []);
        $loaded = 0;
        foreach ($orderIds as $orderId) {
            $detail = ue_fetch_order_detail($orderId, $token);
            if (!($detail['success'] ?? false)) {
                continue;
            }
            $normalized = ue_normalize_order(is_array($detail['payload'] ?? null) ? $detail['payload'] : [], $config, 'ubereats_manual_sync');
            if (($normalized['outletName'] ?? '') === '') {
                $normalized['outletName'] = $outletName;
            }
            $saved[] = $normalized;
            $loaded++;
        }
        $counts[] = ['outletName' => $outletName, 'storeId' => $storeId, 'loaded' => $loaded];
    }

    $merged = ue_save_orders($saved);
    return ['success' => true, 'counts' => $counts, 'savedCount' => count($saved), 'orders' => $merged];
}
