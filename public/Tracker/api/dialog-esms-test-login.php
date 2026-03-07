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
$urlKey = isset($body['esms_url_key']) ? trim((string)$body['esms_url_key']) : '';
$urlKey = dialog_esms_resolve_url_key($urlKey);

if ($urlKey === '' && ($username === '' || $password === '')) {
    respond(['success' => false, 'error' => 'Missing credentials. Provide username/password or URL key.'], 400);
}

try {
    $login = null;
    $loginError = null;
    $remainingCount = null;
    $walletBalance = null;
    $balanceSource = null;
    $dashboardUsername = null;
    $dashboardError = null;
    $urlKeyError = null;

    // Prefer URL key balance because it does not depend on dashboard OTP/session state.
    if ($urlKey !== '') {
        try {
            $urlBalance = dialog_esms_fetch_url_wallet_balance($urlKey);
            if (isset($urlBalance['walletBalance']) && $urlBalance['walletBalance'] !== '') {
                $walletBalance = $urlBalance['walletBalance'];
                $remainingCount = $urlBalance['remainingCount'];
                $balanceSource = 'url_key';
            }
        } catch (Exception $e) {
            $urlKeyError = $e->getMessage();
        }
    }

    // If URL key is present, do not perform username/password login to avoid OTP prompts.
    $shouldTryLoginFlow = ($urlKey === '');

    if ($shouldTryLoginFlow && $username !== '' && $password !== '') {
        try {
            $login = dialog_esms_login($username, $password);
        } catch (Exception $e) {
            $loginError = $e->getMessage();
            throw $e;
        }
    }

    // Prefer live balance from dashboard API (v3 auth), fallback to v2 login fields.
    if ($walletBalance === null && $login !== null && $username !== '' && $password !== '') {
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
    }

    if ($walletBalance === null && $login !== null) {
        $walletBalance = isset($login['walletBalance']) ? $login['walletBalance'] : null;
    }

    if ($balanceSource !== 'dashboard_v1' && $balanceSource !== 'url_key' && $login !== null) {
        if (isset($login['remainingCount']) && $login['remainingCount'] !== '') {
            $remainingCount = is_numeric($login['remainingCount']) ? floatval($login['remainingCount']) : $login['remainingCount'];
        } elseif (isset($login['walletBalance']) && $login['walletBalance'] !== '') {
            $remainingCount = is_numeric($login['walletBalance']) ? floatval($login['walletBalance']) : $login['walletBalance'];
        }
    }

    if ($balanceSource === null && $remainingCount !== null) {
        $balanceSource = 'login_v2';
    }

    if ($walletBalance === null && $remainingCount === null && $login === null) {
        $composedError = $urlKeyError ? ('URL key balance check failed: ' . $urlKeyError) : 'Unable to fetch balance';
        throw new Exception($composedError);
    }

    respond([
        'success' => true,
        'message' => 'Login successful',
        'comment' => is_array($login) && isset($login['comment']) ? $login['comment'] : null,
        'remainingCount' => $remainingCount,
        'walletBalance' => $walletBalance,
        'balanceSource' => $balanceSource,
        'dashboardUsername' => $dashboardUsername,
        'dashboardError' => $dashboardError,
        'urlKeyError' => $urlKeyError,
        'loginError' => $loginError,
        'expiration' => is_array($login) && isset($login['expiration']) ? $login['expiration'] : null,
        'token_length' => is_array($login) && isset($login['token']) ? strlen($login['token']) : 0,
    ]);
} catch (Exception $e) {
    respond(['success' => false, 'error' => $e->getMessage()], 500);
}
