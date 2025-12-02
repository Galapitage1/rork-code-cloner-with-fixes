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

$smtpConfig = isset($body['smtpConfig']) ? $body['smtpConfig'] : null;
$imapConfig = isset($body['imapConfig']) ? $body['imapConfig'] : null;

$results = [
  'smtp' => ['success' => false, 'message' => ''],
  'imap' => ['success' => false, 'message' => ''],
];

if ($smtpConfig && isset($smtpConfig['host']) && isset($smtpConfig['username']) && isset($smtpConfig['password'])) {
  try {
    $host = $smtpConfig['host'];
    $port = isset($smtpConfig['port']) ? intval($smtpConfig['port']) : 587;
    $username = $smtpConfig['username'];
    $password = $smtpConfig['password'];

    $timeout = 10;
    $secure = ($port === 465) ? 'ssl' : 'tcp';
    $socket = @fsockopen("{$secure}://{$host}", $port, $errno, $errstr, $timeout);

    if (!$socket) {
      throw new Exception("Cannot connect to SMTP server: {$errstr}");
    }

    $response = fgets($socket, 512);
    if (substr($response, 0, 3) !== '220') {
      fclose($socket);
      throw new Exception("SMTP server not ready: {$response}");
    }

    fclose($socket);
    $results['smtp']['success'] = true;
    $results['smtp']['message'] = 'SMTP connection successful';
  } catch (Exception $e) {
    $results['smtp']['success'] = false;
    $results['smtp']['message'] = 'SMTP Error: ' . $e->getMessage();
  }
} else {
  $results['smtp']['message'] = 'SMTP settings incomplete';
}

if ($imapConfig && isset($imapConfig['host']) && isset($imapConfig['username']) && isset($imapConfig['password'])) {
  if (function_exists('imap_open')) {
    try {
      $host = $imapConfig['host'];
      $port = isset($imapConfig['port']) ? intval($imapConfig['port']) : 993;
      $username = $imapConfig['username'];
      $password = $imapConfig['password'];

      $secure = ($port === 993) ? '/imap/ssl/novalidate-cert' : '/imap';
      $mailbox = "{{$host}:{$port}{$secure}}";
      
      $imap = @imap_open($mailbox, $username, $password, OP_HALFOPEN);
      
      if ($imap) {
        imap_close($imap);
        $results['imap']['success'] = true;
        $results['imap']['message'] = 'IMAP connection successful';
      } else {
        throw new Exception(imap_last_error() ?: 'Failed to connect');
      }
    } catch (Exception $e) {
      $results['imap']['success'] = false;
      $results['imap']['message'] = 'IMAP Error: ' . $e->getMessage();
    }
  } else {
    $results['imap']['success'] = false;
    $results['imap']['message'] = 'IMAP Error: PHP IMAP extension not installed';
  }
} else {
  $results['imap']['message'] = 'IMAP settings incomplete';
}

respond([
  'success' => true,
  'results' => $results,
]);
