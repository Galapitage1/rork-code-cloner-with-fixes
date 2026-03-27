<?php
// Suppress error display to avoid breaking JSON response
error_reporting(0);
ini_set('display_errors', '0');

// CORS
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
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

$input = file_get_contents('php://input');
if (!$input) { respond([ 'error' => 'Missing body' ], 400); }

$payload = json_decode($input, true);
if (!is_array($payload)) { respond([ 'error' => 'Body must be a JSON array' ], 400); }

$dataDir = __DIR__ . '/../data';
if (!is_dir($dataDir)) { @mkdir($dataDir, 0755, true); }
$filePath = $dataDir . '/' . $endpoint . '.json';

$existing = [];
if (file_exists($filePath)) {
  $contents = file_get_contents($filePath);
  $decoded = json_decode($contents, true);
  if (is_array($decoded)) { $existing = $decoded; }
}

$byId = [];
foreach ($existing as $item) {
  if (is_array($item) && isset($item['id'])) { $byId[$item['id']] = $item; }
}

foreach ($payload as $item) {
  if (!is_array($item) || !isset($item['id'])) { continue; }
  $id = $item['id'];
  $incomingUpdatedAt = isset($item['updatedAt']) && is_numeric($item['updatedAt']) ? intval($item['updatedAt']) : 0;
  if (!isset($byId[$id])) {
    $byId[$id] = $item;
  } else {
    $existingUpdatedAt = isset($byId[$id]['updatedAt']) && is_numeric($byId[$id]['updatedAt']) ? intval($byId[$id]['updatedAt']) : 0;
    if ($incomingUpdatedAt >= $existingUpdatedAt) {
      $byId[$id] = $item;
    }
  }
}

$merged = array_values($byId);

// Remove deleted items older than 7 days to prevent accumulation
$cutoffTime = time() * 1000 - (7 * 24 * 60 * 60 * 1000); // 7 days in milliseconds
$merged = array_filter($merged, function($item) use ($cutoffTime) {
  $isDeleted = isset($item['deleted']) && $item['deleted'] === true;
  if (!$isDeleted) return true;
  
  $updatedAt = isset($item['updatedAt']) && is_numeric($item['updatedAt']) ? intval($item['updatedAt']) : 0;
  return $updatedAt > $cutoffTime;
});
$merged = array_values($merged); // Re-index array after filtering

// Ensure data directory has proper permissions
if (!is_writable($dataDir)) {
  @chmod($dataDir, 0755);
}

// Write directly to the file with proper locking
$fp = @fopen($filePath, 'c+');
if ($fp === false) {
  // Try to create with proper permissions
  $fp = @fopen($filePath, 'w');
  if ($fp === false) {
    respond([ 'error' => 'Failed to open file for writing' ], 500);
  }
}

if (@flock($fp, LOCK_EX)) {
  @ftruncate($fp, 0);
  @rewind($fp);
  @fwrite($fp, json_encode($merged, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
  @fflush($fp);
  @flock($fp, LOCK_UN);
}
@fclose($fp);

// Set file permissions
@chmod($filePath, 0644);

respond($merged);
