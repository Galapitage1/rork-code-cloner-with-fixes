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

$statusesFile = __DIR__ . '/../data/whatsapp-statuses.json';
if (!file_exists($statusesFile)) {
  respond(['success' => true, 'statuses' => [], 'count' => 0]);
}

$contents = file_get_contents($statusesFile);
if (!$contents) {
  respond(['success' => true, 'statuses' => [], 'count' => 0]);
}

$statuses = json_decode($contents, true);
if (!is_array($statuses)) {
  respond(['success' => true, 'statuses' => [], 'count' => 0]);
}

$statusFilter = isset($_GET['status']) ? strtolower(trim((string)$_GET['status'])) : '';
$recipientFilter = isset($_GET['recipient']) ? preg_replace('/[^0-9]/', '', (string)$_GET['recipient']) : '';
$limit = isset($_GET['limit']) ? intval($_GET['limit']) : 200;
if ($limit <= 0) $limit = 200;
if ($limit > 1000) $limit = 1000;

if ($statusFilter !== '') {
  $statuses = array_values(array_filter($statuses, function($e) use ($statusFilter) {
    return isset($e['status']) && strtolower((string)$e['status']) === $statusFilter;
  }));
}

if ($recipientFilter !== '') {
  $statuses = array_values(array_filter($statuses, function($e) use ($recipientFilter) {
    $recipientId = isset($e['recipient_id']) ? preg_replace('/[^0-9]/', '', (string)$e['recipient_id']) : '';
    return $recipientId === $recipientFilter;
  }));
}

usort($statuses, function($a, $b) {
  $timeA = isset($a['timestamp']) ? intval($a['timestamp']) : 0;
  $timeB = isset($b['timestamp']) ? intval($b['timestamp']) : 0;
  if ($timeA === $timeB) {
    $receivedA = isset($a['receivedAt']) ? intval($a['receivedAt']) : 0;
    $receivedB = isset($b['receivedAt']) ? intval($b['receivedAt']) : 0;
    return $receivedB - $receivedA;
  }
  return $timeB - $timeA;
});

$statuses = array_slice($statuses, 0, $limit);

respond([
  'success' => true,
  'statuses' => $statuses,
  'count' => count($statuses),
]);

