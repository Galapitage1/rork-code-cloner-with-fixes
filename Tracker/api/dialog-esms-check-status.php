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
$transactionId = isset($body['transaction_id']) ? $body['transaction_id'] : null;

if (!$settings || empty($transactionId)) {
    respond(['success' => false, 'error' => 'Missing required fields'], 400);
}

try {
    $tokenData = dialog_esms_login($settings['esms_username'], $settings['esms_password']);
    $token = $tokenData['token'];

    $result = dialog_esms_check_transaction($token, $transactionId);
    if (!empty($result['curlError'])) {
        throw new Exception('Connection error: ' . $result['curlError']);
    }

    respond([
        'success' => true,
        'data' => is_array($result['data']) ? $result['data'] : ['raw' => $result['raw']],
    ]);
} catch (Exception $e) {
    respond(['success' => false, 'error' => $e->getMessage()], 500);
}

