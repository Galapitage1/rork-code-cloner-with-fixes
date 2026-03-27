<?php
error_reporting(0);
ini_set('display_errors', '0');

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
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

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
  respond(['success' => false, 'error' => 'Method not allowed'], 405);
}

$messagesFile = __DIR__ . '/../data/whatsapp-messages.json';

if (!file_exists($messagesFile)) {
  respond([
    'success' => true,
    'messages' => [],
  ]);
}

$contents = file_get_contents($messagesFile);
if (!$contents) {
  respond([
    'success' => true,
    'messages' => [],
  ]);
}

$messages = json_decode($contents, true);
if (!is_array($messages)) {
  respond([
    'success' => true,
    'messages' => [],
  ]);
}

usort($messages, function($a, $b) {
  $timeA = isset($a['timestamp']) ? $a['timestamp'] : 0;
  $timeB = isset($b['timestamp']) ? $b['timestamp'] : 0;
  return $timeB - $timeA;
});

respond([
  'success' => true,
  'messages' => $messages,
  'count' => count($messages),
]);
