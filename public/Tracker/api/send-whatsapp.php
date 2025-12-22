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
$message = isset($body['message']) ? trim($body['message']) : '';
$recipients = isset($body['recipients']) ? $body['recipients'] : [];
$mediaUrl = isset($body['mediaUrl']) ? trim($body['mediaUrl']) : '';
$mediaType = isset($body['mediaType']) ? trim($body['mediaType']) : 'image';
$caption = isset($body['caption']) ? trim($body['caption']) : '';

if (!empty($mediaUrl)) {
  if (!filter_var($mediaUrl, FILTER_VALIDATE_URL)) {
    respond(['success' => false, 'error' => 'Invalid media URL format'], 400);
  }
  if (strpos($mediaUrl, 'https://') !== 0) {
    respond(['success' => false, 'error' => 'Media URL must use HTTPS'], 400);
  }
}

if (empty($accessToken) || empty($phoneNumberId) || empty($recipients)) {
  respond(['success' => false, 'error' => 'Missing required fields'], 400);
}

if (empty($message) && empty($mediaUrl)) {
  respond(['success' => false, 'error' => 'Either message or media URL is required'], 400);
}

$results = [
  'success' => 0,
  'failed' => 0,
  'errors' => [],
];

foreach ($recipients as $recipient) {
  if (!isset($recipient['phone']) || empty($recipient['phone'])) {
    $results['failed']++;
    $results['errors'][] = ($recipient['name'] ?? 'Unknown') . ': No phone number';
    continue;
  }

  $phone = trim($recipient['phone']);
  $phone = preg_replace('/[^0-9+]/', '', $phone);
  
  if (substr($phone, 0, 1) === '0') {
    $phone = '94' . substr($phone, 1);
  } elseif (substr($phone, 0, 1) === '+') {
    $phone = substr($phone, 1);
  } elseif (substr($phone, 0, 2) !== '94') {
    $phone = '94' . $phone;
  }

  $url = "https://graph.facebook.com/v21.0/{$phoneNumberId}/messages";
  
  if (!empty($mediaUrl)) {
    $messageBody = [
      'messaging_product' => 'whatsapp',
      'recipient_type' => 'individual',
      'to' => $phone,
      'type' => $mediaType,
    ];
    
    $messageBody[$mediaType] = ['link' => $mediaUrl];
    
    if (!empty($caption) && in_array($mediaType, ['image', 'video', 'document'])) {
      $messageBody[$mediaType]['caption'] = $caption;
    }
    
    $payload = json_encode($messageBody);
  } else {
    $payload = json_encode([
      'messaging_product' => 'whatsapp',
      'recipient_type' => 'individual',
      'to' => $phone,
      'type' => 'text',
      'text' => [
        'preview_url' => false,
        'body' => $message,
      ],
    ]);
  }

  $ch = curl_init();
  curl_setopt($ch, CURLOPT_URL, $url);
  curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
  curl_setopt($ch, CURLOPT_POST, true);
  curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
  curl_setopt($ch, CURLOPT_HTTPHEADER, [
    "Authorization: Bearer {$accessToken}",
    'Content-Type: application/json',
  ]);
  curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
  curl_setopt($ch, CURLOPT_TIMEOUT, 30);

  $response = curl_exec($ch);
  $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  $curlError = curl_error($ch);
  curl_close($ch);

  if ($curlError) {
    $results['failed']++;
    $results['errors'][] = ($recipient['name'] ?? 'Unknown') . ": {$curlError}";
    continue;
  }

  $data = json_decode($response, true);

  if ($httpCode !== 200 || isset($data['error'])) {
    $errorMsg = isset($data['error']['message']) ? $data['error']['message'] : 'Failed to send message';
    $results['failed']++;
    $results['errors'][] = ($recipient['name'] ?? 'Unknown') . ": {$errorMsg}";
  } else {
    $results['success']++;
  }

  usleep(1000000);
}

respond([
  'success' => true,
  'results' => $results,
]);
