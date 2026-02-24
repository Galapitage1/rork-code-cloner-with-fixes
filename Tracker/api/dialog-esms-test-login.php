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

if ($username === '' || $password === '') {
    respond(['success' => false, 'error' => 'Missing username or password'], 400);
}

try {
    $login = dialog_esms_login($username, $password);
    respond([
        'success' => true,
        'message' => 'Login successful',
        'token_length' => isset($login['token']) ? strlen($login['token']) : 0,
    ]);
} catch (Exception $e) {
    respond(['success' => false, 'error' => $e->getMessage()], 500);
}

