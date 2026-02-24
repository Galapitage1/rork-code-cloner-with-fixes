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
$message = isset($body['message']) ? trim($body['message']) : '';
$recipients = isset($body['recipients']) && is_array($body['recipients']) ? $body['recipients'] : [];
$sourceAddress = isset($body['source_address']) ? trim((string)$body['source_address']) : '';
$paymentMethod = isset($body['payment_method']) ? intval($body['payment_method']) : null;

if (!$settings || $message === '' || count($recipients) === 0) {
    respond(['success' => false, 'error' => 'Missing required fields'], 400);
}

if (count($recipients) > 1000) {
    respond(['success' => false, 'error' => 'Maximum 1000 recipients per campaign'], 400);
}

$normalizedRecipients = [];
$invalidNumbers = [];

foreach ($recipients as $recipient) {
    $mobile = isset($recipient['mobile']) ? $recipient['mobile'] : '';
    try {
        $normalized = dialog_esms_normalize_mobile($mobile);
        $normalizedRecipients[] = [
            'mobile' => $normalized,
            'original' => $mobile,
        ];
    } catch (Exception $e) {
        $invalidNumbers[] = $mobile;
    }
}

if (count($normalizedRecipients) === 0) {
    respond(['success' => false, 'error' => 'No valid mobile numbers found'], 400);
}

try {
    $tokenData = dialog_esms_login($settings['esms_username'], $settings['esms_password']);
    $token = $tokenData['token'];

    $payload = [
        'msisdn' => array_map(function($r) { return ['mobile' => $r['mobile']]; }, $normalizedRecipients),
        'message' => $message,
        'transaction_id' => round(microtime(true) * 1000) + rand(0, 999),
        'payment_method' => ($paymentMethod !== null ? $paymentMethod : (isset($settings['default_payment_method']) ? intval($settings['default_payment_method']) : 0)),
    ];

    $effectiveSource = $sourceAddress !== '' ? $sourceAddress : (isset($settings['default_source_address']) ? trim((string)$settings['default_source_address']) : '');
    if ($effectiveSource !== '') {
        $payload['sourceAddress'] = $effectiveSource;
    }

    if (!empty($settings['push_notification_url'])) {
        $payload['push_notification_url'] = $settings['push_notification_url'];
    }

    $result = dialog_esms_post_sms($token, $payload);
    if (!empty($result['curlError'])) {
        throw new Exception('Connection error: ' . $result['curlError']);
    }
    $data = is_array($result['data']) ? $result['data'] : [];

    if ((isset($data['errCode']) && intval($data['errCode']) === 104) || (isset($data['comment']) && stripos($data['comment'], 'already used') !== false)) {
        $payload['transaction_id'] = round(microtime(true) * 1000) + rand(1000, 9999);
        $result = dialog_esms_post_sms($token, $payload);
        if (!empty($result['curlError'])) {
            throw new Exception('Connection error: ' . $result['curlError']);
        }
        $data = is_array($result['data']) ? $result['data'] : [];
    }

    if ((isset($data['errCode']) && intval($data['errCode']) === 401) || (isset($data['comment']) && stripos($data['comment'], 'token') !== false)) {
        $tokenData = dialog_esms_login($settings['esms_username'], $settings['esms_password']);
        $token = $tokenData['token'];
        $result = dialog_esms_post_sms($token, $payload);
        if (!empty($result['curlError'])) {
            throw new Exception('Connection error: ' . $result['curlError']);
        }
        $data = is_array($result['data']) ? $result['data'] : [];
    }

    respond([
        'success' => ($result['httpCode'] >= 200 && $result['httpCode'] < 300 && !isset($data['errCode'])),
        'data' => [
            'transaction_id' => $payload['transaction_id'],
            'campaign_id' => isset($data['data']['campaignId']) ? $data['data']['campaignId'] : null,
            'campaign_cost' => isset($data['data']['campaignCost']) ? $data['data']['campaignCost'] : null,
            'wallet_balance' => isset($data['walletBalance']) ? $data['walletBalance'] : null,
            'duplicates_removed' => isset($data['duplicatesRemoved']) ? $data['duplicatesRemoved'] : 0,
            'invalid_numbers' => (isset($data['invalidNumbers']) ? intval($data['invalidNumbers']) : 0) + count($invalidNumbers),
            'mask_blocked_numbers' => isset($data['mask_blocked_numbers']) ? $data['mask_blocked_numbers'] : null,
            'status' => isset($data['status']) ? $data['status'] : null,
            'comment' => isset($data['comment']) ? $data['comment'] : null,
            'errCode' => isset($data['errCode']) ? $data['errCode'] : null,
            'recipients' => $normalizedRecipients,
            'invalidNumbersList' => $invalidNumbers,
        ],
    ]);
} catch (Exception $e) {
    respond(['success' => false, 'error' => $e->getMessage()], 500);
}

