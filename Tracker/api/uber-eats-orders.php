<?php
require_once __DIR__ . '/uber_eats_common.php';

ue_preflight('GET, POST, OPTIONS');

$action = ue_trim($_GET['action'] ?? '', 80);
$body = $_SERVER['REQUEST_METHOD'] === 'POST'
    ? (json_decode(file_get_contents('php://input') ?: '', true) ?: [])
    : [];

if ($action === '') {
    $action = ue_trim($body['action'] ?? 'sync', 80);
}

$config = ue_load_campaign_settings();

if ($action === 'test') {
    $tokenData = ue_get_access_token($config);
    if (!($tokenData['success'] ?? false)) {
        ue_respond(['success' => false, 'error' => $tokenData['error'] ?? 'Failed to authenticate with Uber Eats'], 400);
    }
    $stores = ue_list_stores((string)$tokenData['token']);
    if (!($stores['success'] ?? false)) {
        ue_respond(['success' => false, 'error' => $stores['error'] ?? 'Failed to load stores'], 400);
    }
    ue_respond([
        'success' => true,
        'stores' => $stores['stores'] ?? [],
        'mappedOutletCount' => count($config['outletConfigs'] ?? []),
    ]);
}

if ($action === 'sync') {
    $outletName = ue_trim($body['outletName'] ?? '', 160);
    $result = ue_sync_recent_orders($config, $outletName);
    if (!($result['success'] ?? false)) {
        ue_respond(['success' => false, 'error' => $result['error'] ?? 'Failed to sync Uber Eats orders'], 400);
    }
    ue_respond([
        'success' => true,
        'savedCount' => (int)($result['savedCount'] ?? 0),
        'counts' => $result['counts'] ?? [],
    ]);
}

if ($action === 'info') {
    $mapped = [];
    foreach (($config['outletConfigs'] ?? []) as $row) {
        if (!is_array($row)) {
            continue;
        }
        $mapped[] = [
            'outletName' => ue_trim($row['outletName'] ?? '', 160),
            'storeId' => ue_trim($row['storeId'] ?? '', 180),
            'storeName' => ue_trim($row['storeName'] ?? '', 220),
        ];
    }
    ue_respond([
        'success' => true,
        'clientConfigured' => (($config['clientId'] ?? '') !== '' && ($config['clientSecret'] ?? '') !== ''),
        'mappedOutlets' => $mapped,
        'webhookUrl' => 'https://tracker.tecclk.com/Tracker/api/uber-eats-webhook.php',
    ]);
}

ue_respond(['success' => false, 'error' => 'Unsupported action'], 400);
