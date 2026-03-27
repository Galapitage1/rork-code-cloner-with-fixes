<?php
require 'sms_service.php';

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

$message = isset($body['message']) ? trim($body['message']) : '';
$recipients = isset($body['recipients']) ? $body['recipients'] : [];
$transactionId = isset($body['transaction_id']) ? $body['transaction_id'] : time();

if (empty($message) || empty($recipients)) {
    respond(['success' => false, 'error' => 'Missing required fields (message, recipients)'], 400);
}

$mobiles = [];
foreach ($recipients as $recipient) {
    if (isset($recipient['phone']) && !empty($recipient['phone'])) {
        $mobiles[] = $recipient['phone'];
    }
}

if (empty($mobiles)) {
    respond(['success' => false, 'error' => 'No valid phone numbers provided'], 400);
}

try {
    $result = send_sms_esms($mobiles, $message, $transactionId);
    respond([
        'success' => true,
        'results' => $result['results'],
        'message' => $result['message'],
    ]);
} catch (Exception $e) {
    respond(['success' => false, 'error' => $e->getMessage()], 500);
}
