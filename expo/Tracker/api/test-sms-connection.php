<?php
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
if (!$input) {
    respond(['success' => false, 'error' => 'Missing request body'], 400);
}

$body = json_decode($input, true);
if (!is_array($body)) {
    respond(['success' => false, 'error' => 'Invalid JSON'], 400);
}

$smsApiUrl = isset($body['smsApiUrl']) ? trim($body['smsApiUrl']) : '';
$smsApiKey = isset($body['smsApiKey']) ? trim($body['smsApiKey']) : '';

if (empty($smsApiUrl) || empty($smsApiKey)) {
    respond(['success' => false, 'error' => 'Missing SMS API URL or API Key'], 400);
}

$testPayload = json_encode([
    'user_id' => '11217',
    'api_key' => $smsApiKey,
    'sender_id' => 'NotifyDEMO',
    'to' => '94777123456',
    'message' => 'Test message from Campaign Manager',
]);

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $smsApiUrl);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_POST, true);
curl_setopt($ch, CURLOPT_POSTFIELDS, $testPayload);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer {$smsApiKey}",
    'Content-Type: application/json',
]);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
    respond([
        'success' => false,
        'error' => "Connection error: {$curlError}",
    ], 500);
}

$data = json_decode($response, true);

if ($httpCode === 200 && isset($data['status']) && $data['status'] === 'success') {
    respond([
        'success' => true,
        'message' => 'SMS API connection successful',
    ]);
} else {
    $errorMsg = isset($data['message']) ? $data['message'] : 'API connection failed';
    respond([
        'success' => false,
        'error' => "API Error (HTTP {$httpCode}): {$errorMsg}",
        'response' => $data,
    ], 400);
}
