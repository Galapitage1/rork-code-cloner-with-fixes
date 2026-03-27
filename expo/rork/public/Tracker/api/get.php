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

$dataDir = __DIR__ . '/../data';
$filePath = $dataDir . '/' . $endpoint . '.json';

if (!file_exists($filePath)) { respond([]); }

$contents = file_get_contents($filePath);
$decoded = json_decode($contents, true);
if (!is_array($decoded)) { respond([]); }
respond($decoded);
