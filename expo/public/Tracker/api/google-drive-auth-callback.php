<?php
require_once __DIR__ . '/backup-common.php';

$origin = gd_backup_current_origin();
$redirectTo = '/settings';
$errorMessage = '';

try {
    if (isset($_GET['error'])) {
        throw new Exception((string)$_GET['error']);
    }

    $state = isset($_GET['state']) ? (string)$_GET['state'] : '';
    $stateResult = gd_backup_consume_oauth_state($state);
    $redirectTo = $stateResult['returnTo'];
    if (!$stateResult['valid']) {
        throw new Exception('Invalid or expired Google Drive connection state. Please try again.');
    }

    $code = isset($_GET['code']) ? trim((string)$_GET['code']) : '';
    if ($code === '') {
        throw new Exception('Missing Google authorization code');
    }

    $settings = gd_backup_load_settings();
    $tokens = gd_backup_exchange_code_for_tokens($code, (string)($settings['client_id'] ?? ''), (string)($settings['client_secret'] ?? ''));
    $refreshToken = isset($tokens['refresh_token']) ? trim((string)$tokens['refresh_token']) : '';
    if ($refreshToken === '') {
        throw new Exception('Google did not return a refresh token. Please reconnect and allow consent.');
    }

    gd_backup_store_refresh_token($refreshToken);
    $separator = strpos($redirectTo, '?') === false ? '?' : '&';
    header('Location: ' . $origin . $redirectTo . $separator . 'backupConnected=1');
    exit;
} catch (Exception $e) {
    $errorMessage = $e->getMessage();
    $separator = strpos($redirectTo, '?') === false ? '?' : '&';
    header('Location: ' . $origin . $redirectTo . $separator . 'backupError=' . rawurlencode($errorMessage));
    exit;
}
