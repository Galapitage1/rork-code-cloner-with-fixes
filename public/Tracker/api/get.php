<?php
// CORS
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }

function respond($data, $status = 200) {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

$endpoint = isset($_GET['endpoint']) ? preg_replace('/[^a-zA-Z0-9_-]/', '', $_GET['endpoint']) : '';
if ($endpoint === '') { respond([ 'error' => 'Missing endpoint' ], 400); }

// Support incremental sync with 'since' parameter
$since = isset($_GET['since']) && is_numeric($_GET['since']) ? intval($_GET['since']) : 0;

$dataDir = __DIR__ . '/../data';
$filePath = $dataDir . '/' . $endpoint . '.json';

if (!file_exists($filePath)) { respond([]); }

$contents = file_get_contents($filePath);
$decoded = json_decode($contents, true);
if (!is_array($decoded)) { respond([]); }

// If 'since' parameter is provided, filter to only items updated after that timestamp
if ($since > 0) {
  $filtered = array_filter($decoded, function($item) use ($since) {
    $updatedAt = isset($item['updatedAt']) && is_numeric($item['updatedAt']) ? intval($item['updatedAt']) : 0;
    return $updatedAt > $since;
  });
  respond(array_values($filtered));
} else {
  respond($decoded);
}
