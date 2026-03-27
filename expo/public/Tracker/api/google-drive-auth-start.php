<?php
require_once __DIR__ . '/backup-common.php';

try {
    $settings = gd_backup_load_settings();
    $clientId = trim((string)($settings['client_id'] ?? ''));
    $clientSecret = trim((string)($settings['client_secret'] ?? ''));
    if ($clientId === '' || $clientSecret === '') {
        throw new Exception('Save Google Client ID and Client Secret first.');
    }

    $returnTo = isset($_GET['returnTo']) ? trim((string)$_GET['returnTo']) : '/settings';
    if ($returnTo === '') {
        $returnTo = '/settings';
    }

    $state = bin2hex(random_bytes(16));
    gd_backup_store_oauth_state($state, $returnTo);

    $params = [
        'client_id' => $clientId,
        'redirect_uri' => gd_backup_callback_url(),
        'response_type' => 'code',
        'scope' => GD_BACKUP_SCOPE,
        'access_type' => 'offline',
        'prompt' => 'consent',
        'state' => $state,
    ];

    header('Location: https://accounts.google.com/o/oauth2/v2/auth?' . http_build_query($params));
    exit;
} catch (Exception $e) {
    $returnTo = isset($_GET['returnTo']) ? trim((string)$_GET['returnTo']) : '/settings';
    $origin = gd_backup_current_origin();
    $separator = strpos($returnTo, '?') === false ? '?' : '&';
    header('Location: ' . $origin . $returnTo . $separator . 'backupError=' . rawurlencode($e->getMessage()));
    exit;
}
