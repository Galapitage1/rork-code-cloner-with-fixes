<?php
require_once __DIR__ . '/uber_eats_common.php';

ue_preflight('POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    ue_respond(['success' => false, 'error' => 'Method not allowed'], 405);
}

$rawBody = file_get_contents('php://input') ?: '';
$payload = json_decode($rawBody, true);
if (!is_array($payload)) {
    ue_respond(['success' => false, 'error' => 'Invalid JSON payload'], 400);
}

$config = ue_load_campaign_settings();
$signature = ue_extract_header('X-Uber-Signature');
$clientSecret = ue_trim($config['clientSecret'] ?? '', 260);
if ($clientSecret !== '') {
    if (!ue_verify_webhook_signature($rawBody, $signature, $clientSecret)) {
        ue_append_webhook_event([
            'receivedAt' => ue_now_ms(),
            'verified' => false,
            'signature' => $signature,
            'payload' => $payload,
        ]);
        ue_respond(['success' => false, 'error' => 'Invalid webhook signature'], 401);
    }
}

$eventType = ue_trim($payload['event_type'] ?? ($payload['type'] ?? ''), 120);
$orderId = ue_extract_order_id_from_webhook($payload);
$storeId = ue_extract_store_id_from_payload($payload);

ue_append_webhook_event([
    'receivedAt' => ue_now_ms(),
    'verified' => true,
    'eventType' => $eventType,
    'orderId' => $orderId,
    'storeId' => $storeId,
    'payload' => $payload,
]);

$response = ['success' => true];
if (function_exists('fastcgi_finish_request')) {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (ob_get_level() > 0) {
        @ob_flush();
    }
    @flush();
    fastcgi_finish_request();
} else {
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($response, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    if (ob_get_level() > 0) {
        @ob_flush();
    }
    @flush();
}

if ($orderId !== '' && stripos($eventType, 'orders.notification') !== false) {
    ue_sync_single_order($orderId, $config, 'ubereats_webhook');
}

exit;
