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

$settings = isset($body['settings']) && is_array($body['settings']) ? $body['settings'] : null;
$mobile = isset($body['mobile']) ? trim($body['mobile']) : '';
$message = isset($body['message']) ? trim($body['message']) : '';

if (!$settings || $mobile === '' || $message === '') {
    respond(['success' => false, 'error' => 'Missing required fields'], 400);
}

try {
    $tokenData = dialog_esms_login($settings['esms_username'], $settings['esms_password']);
    $token = $tokenData['token'];
    $normalizedMobile = dialog_esms_normalize_mobile($mobile);
    $transactionId = round(microtime(true) * 1000);

    $payload = [
        'msisdn' => [['mobile' => $normalizedMobile]],
        'message' => $message,
        'transaction_id' => $transactionId,
        'payment_method' => isset($settings['default_payment_method']) ? intval($settings['default_payment_method']) : 0,
    ];

    if (!empty($settings['default_source_address'])) {
        $payload['sourceAddress'] = $settings['default_source_address'];
    }

    $result = dialog_esms_post_sms($token, $payload);
    if (!empty($result['curlError'])) {
        throw new Exception('Connection error: ' . $result['curlError']);
    }

    $data = is_array($result['data']) ? $result['data'] : [];
    if ($result['httpCode'] < 200 || $result['httpCode'] >= 300 || isset($data['errCode'])) {
        $msg = isset($data['comment']) ? $data['comment'] : (isset($data['message']) ? $data['message'] : 'Failed to send test SMS');
        throw new Exception($msg);
    }

    respond([
        'success' => true,
        'message' => 'Test SMS sent successfully',
        'data' => $data,
    ]);
} catch (Exception $e) {
    respond(['success' => false, 'error' => $e->getMessage()], 500);
}

