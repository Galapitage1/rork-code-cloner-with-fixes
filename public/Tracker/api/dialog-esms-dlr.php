<?php
error_reporting(0);
ini_set('display_errors', '0');
ini_set('log_errors', '1');

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

function logMessage($message) {
  $logDir = __DIR__ . '/../logs';
  if (!is_dir($logDir)) {
    @mkdir($logDir, 0755, true);
  }
  $timestamp = date('Y-m-d H:i:s');
  @error_log("[{$timestamp}] {$message}\n", 3, $logDir . '/sms-dlr.log');
}

function readJsonArrayFile($filePath) {
  if (!file_exists($filePath)) {
    return [];
  }
  $contents = @file_get_contents($filePath);
  if (!$contents) {
    return [];
  }
  $decoded = json_decode($contents, true);
  return is_array($decoded) ? $decoded : [];
}

function writeJsonArrayFile($filePath, $data) {
  $dataDir = dirname($filePath);
  if (!is_dir($dataDir)) {
    @mkdir($dataDir, 0755, true);
  }
  @file_put_contents(
    $filePath,
    json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT),
    LOCK_EX
  );
  @chmod($filePath, 0644);
}

function textValue($arr, $keys) {
  if (!is_array($arr)) {
    return '';
  }
  foreach ($keys as $key) {
    if (isset($arr[$key])) {
      return trim((string)$arr[$key]);
    }
  }
  return '';
}

function collectEventFromSource($source, $method) {
  $campaignId = textValue($source, ['campaignId', 'campaign_id', 'campaignID']);
  $msisdn = textValue($source, ['msisdn', 'mobile', 'recipient', 'to']);
  $statusRaw = textValue($source, ['status', 'delivery_status', 'deliveryStatus']);
  $transactionId = textValue($source, ['transaction_id', 'transactionId']);

  if ($campaignId === '' && $msisdn === '' && $statusRaw === '') {
    return null;
  }

  return [
    'id' => uniqid('sms_dlr_', true),
    'campaignId' => $campaignId,
    'msisdn' => $msisdn,
    'status' => is_numeric($statusRaw) ? intval($statusRaw) : $statusRaw,
    'statusRaw' => $statusRaw,
    'transactionId' => $transactionId,
    'method' => $method,
    'receivedAt' => time(),
    'query' => $_GET,
    'raw' => $source,
  ];
}

function persistEvent($event) {
  $eventsFile = __DIR__ . '/../data/sms-dlr-events.json';
  $events = readJsonArrayFile($eventsFile);
  $events[] = $event;

  if (count($events) > 5000) {
    $events = array_slice($events, -5000);
  }

  writeJsonArrayFile($eventsFile, $events);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  if (isset($_GET['events'])) {
    $campaignId = isset($_GET['campaignId']) ? trim((string)$_GET['campaignId']) : '';
    $eventsFile = __DIR__ . '/../data/sms-dlr-events.json';
    $events = readJsonArrayFile($eventsFile);

    if ($campaignId !== '') {
      $events = array_values(array_filter($events, function($e) use ($campaignId) {
        return isset($e['campaignId']) && (string)$e['campaignId'] === $campaignId;
      }));
    }

    usort($events, function($a, $b) {
      return intval($b['receivedAt'] ?? 0) - intval($a['receivedAt'] ?? 0);
    });

    $limit = isset($_GET['limit']) ? intval($_GET['limit']) : 200;
    if ($limit <= 0) $limit = 200;
    if ($limit > 1000) $limit = 1000;

    $events = array_slice($events, 0, $limit);

    http_response_code(200);
    echo json_encode(['success' => true, 'events' => $events, 'count' => count($events)]);
    exit;
  }

  $event = collectEventFromSource($_GET, 'GET');
  if ($event !== null) {
    persistEvent($event);
    logMessage('DLR received (GET): campaign=' . ($event['campaignId'] ?: '-') . ' msisdn=' . ($event['msisdn'] ?: '-') . ' status=' . (string)$event['statusRaw']);
  } else {
    logMessage('DLR GET received without recognizable DLR fields: ' . json_encode($_GET));
  }

  http_response_code(200);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'OK';
  exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $rawInput = file_get_contents('php://input');
  $json = json_decode($rawInput ?: '', true);

  $source = [];
  if (is_array($json)) {
    $source = $json;
  } elseif (!empty($_POST) && is_array($_POST)) {
    $source = $_POST;
  } else {
    parse_str($rawInput ?: '', $parsed);
    if (is_array($parsed)) {
      $source = $parsed;
    }
  }

  $event = collectEventFromSource($source, 'POST');
  if ($event !== null) {
    $event['rawBody'] = $rawInput;
    persistEvent($event);
    logMessage('DLR received (POST): campaign=' . ($event['campaignId'] ?: '-') . ' msisdn=' . ($event['msisdn'] ?: '-') . ' status=' . (string)$event['statusRaw']);
  } else {
    logMessage('DLR POST received without recognizable DLR fields. raw=' . ($rawInput ?: ''));
  }

  http_response_code(200);
  header('Content-Type: text/plain; charset=utf-8');
  echo 'OK';
  exit;
}

http_response_code(405);
echo json_encode(['success' => false, 'error' => 'Method not allowed']);
