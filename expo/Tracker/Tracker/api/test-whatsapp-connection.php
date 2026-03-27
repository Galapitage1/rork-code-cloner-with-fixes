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

$accessToken = isset($body['accessToken']) ? trim($body['accessToken']) : '';
$phoneNumberId = isset($body['phoneNumberId']) ? trim($body['phoneNumberId']) : '';

if (empty($accessToken) || empty($phoneNumberId)) {
  respond(['success' => false, 'error' => 'Missing access token or phone number ID'], 400);
}

$url = "https://graph.facebook.com/v21.0/{$phoneNumberId}";

$ch = curl_init();
curl_setopt($ch, CURLOPT_URL, $url);
curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
curl_setopt($ch, CURLOPT_HTTPHEADER, [
  "Authorization: Bearer {$accessToken}",
]);
curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
curl_setopt($ch, CURLOPT_TIMEOUT, 30);

$response = curl_exec($ch);
$httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
$curlError = curl_error($ch);
curl_close($ch);

if ($curlError) {
  respond(['success' => false, 'error' => "Connection error: {$curlError}"], 500);
}

$data = json_decode($response, true);

if ($httpCode !== 200) {
  $errorMsg = isset($data['error']['message']) ? $data['error']['message'] : 
              (isset($data['error']['error_user_msg']) ? $data['error']['error_user_msg'] : 'Failed to verify WhatsApp configuration');
  respond(['success' => false, 'error' => $errorMsg], $httpCode);
}

$displayPhone = isset($data['display_phone_number']) ? $data['display_phone_number'] : $phoneNumberId;

respond([
  'success' => true,
  'message' => "WhatsApp Business API connected successfully. Phone: {$displayPhone}",
  'data' => $data,
]);
