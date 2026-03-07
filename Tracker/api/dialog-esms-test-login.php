<?php
require 'dialog_esms_service.php';

error_reporting(0);
ini_set('display_errors', '0');

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
}

function respond($data, $status = 200) {
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    respond(['success' => false, 'error' => 'Method not allowed'], 405);
}

$input = file_get_contents('php://input');
$body = json_decode($input ?: '', true);
if (!is_array($body)) {
    respond(['success' => false, 'error' => 'Invalid JSON'], 400);
}

$username = isset($body['esms_username']) ? trim($body['esms_username']) : '';
$password = isset($body['esms_password']) ? trim($body['esms_password']) : '';
$password = dialog_esms_resolve_password($password);

if ($username === '' || $password === '') {
    respond(['success' => false, 'error' => 'Missing username or password'], 400);
}

try {
    $login = dialog_esms_login($username, $password);
    $remainingCount = null;
    $walletBalance = null;
    $balanceSource = null;
    $dashboardUsername = null;
    $dashboardError = null;

    // Prefer live balance from dashboard API (v3 auth), fallback to v2 login fields.
    try {
        $dashboard = dialog_esms_fetch_dashboard_wallet_balance($username, $password);
        if (isset($dashboard['walletBalance']) && $dashboard['walletBalance'] !== '') {
            $walletBalance = $dashboard['walletBalance'];
            $remainingCount = $dashboard['walletBalance'];
            $balanceSource = 'dashboard_v1';
            $dashboardUsername = isset($dashboard['username']) ? $dashboard['username'] : null;
        }
    } catch (Exception $e) {
        $dashboardError = $e->getMessage();
    }

    if ($walletBalance === null) {
        $walletBalance = isset($login['walletBalance']) ? $login['walletBalance'] : null;
    }

    if ($balanceSource !== 'dashboard_v1') {
        if (isset($login['remainingCount']) && $login['remainingCount'] !== '') {
            $remainingCount = is_numeric($login['remainingCount']) ? floatval($login['remainingCount']) : $login['remainingCount'];
        } elseif (isset($login['walletBalance']) && $login['walletBalance'] !== '') {
            $remainingCount = is_numeric($login['walletBalance']) ? floatval($login['walletBalance']) : $login['walletBalance'];
        }
    }

    if ($balanceSource === null && $remainingCount !== null) {
        $balanceSource = 'login_v2';
    }

    respond([
        'success' => true,
        'message' => 'Login successful',
        'comment' => isset($login['comment']) ? $login['comment'] : null,
        'remainingCount' => $remainingCount,
        'walletBalance' => $walletBalance,
        'balanceSource' => $balanceSource,
        'dashboardUsername' => $dashboardUsername,
        'dashboardError' => $dashboardError,
        'expiration' => isset($login['expiration']) ? $login['expiration'] : null,
        'token_length' => isset($login['token']) ? strlen($login['token']) : 0,
    ]);
} catch (Exception $e) {
    respond(['success' => false, 'error' => $e->getMessage()], 500);
}
