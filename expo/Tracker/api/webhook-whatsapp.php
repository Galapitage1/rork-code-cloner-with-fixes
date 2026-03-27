<?php
error_reporting(E_ALL);
ini_set('display_errors', '1');
ini_set('log_errors', '1');
ini_set('error_log', __DIR__ . '/../logs/whatsapp-webhook.log');

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
  error_log("[{$timestamp}] {$message}\n", 3, $logDir . '/whatsapp-webhook.log');
}

function respond($data, $status = 200) {
  http_response_code($status);
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function readJsonArrayFile($filePath) {
  if (!file_exists($filePath)) {
    return [];
  }
  $contents = file_get_contents($filePath);
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
  file_put_contents($filePath, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT));
  @chmod($filePath, 0644);
}

if ($_SERVER['REQUEST_METHOD'] === 'GET') {
  $mode = isset($_GET['hub_mode']) ? $_GET['hub_mode'] : '';
  $token = isset($_GET['hub_verify_token']) ? $_GET['hub_verify_token'] : '';
  $challenge = isset($_GET['hub_challenge']) ? $_GET['hub_challenge'] : '';
  
  $verifyToken = '29cd61c6734226c38374a72c8106d0a5';
  
  logMessage("Webhook verification request - Mode: {$mode}, Token matches: " . ($token === $verifyToken ? 'yes' : 'no'));
  
  if ($mode === 'subscribe' && $token === $verifyToken) {
    logMessage("Webhook verified successfully");
    http_response_code(200);
    echo $challenge;
    exit;
  } else {
    logMessage("Webhook verification failed");
    http_response_code(403);
    echo 'Forbidden';
    exit;
  }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
  $input = file_get_contents('php://input');
  logMessage("Received webhook POST: " . $input);
  
  if (!$input) {
    logMessage("Empty webhook payload");
    respond(['success' => false, 'error' => 'Empty payload'], 400);
  }
  
  $data = json_decode($input, true);
  if (!$data) {
    logMessage("Invalid JSON in webhook payload");
    respond(['success' => false, 'error' => 'Invalid JSON'], 400);
  }
  
  if (isset($data['object']) && $data['object'] === 'whatsapp_business_account') {
    if (isset($data['entry']) && is_array($data['entry'])) {
      foreach ($data['entry'] as $entry) {
        if (isset($entry['changes']) && is_array($entry['changes'])) {
          foreach ($entry['changes'] as $change) {
            if (isset($change['value']['messages']) && is_array($change['value']['messages'])) {
              foreach ($change['value']['messages'] as $message) {
                $from = isset($message['from']) ? $message['from'] : 'unknown';
                $messageId = isset($message['id']) ? $message['id'] : 'unknown';
                $timestamp = isset($message['timestamp']) ? $message['timestamp'] : time();
                $type = isset($message['type']) ? $message['type'] : 'unknown';
                
                $messageText = '';
                if ($type === 'text' && isset($message['text']['body'])) {
                  $messageText = $message['text']['body'];
                }
                
                $contactName = 'Unknown';
                if (isset($change['value']['contacts']) && is_array($change['value']['contacts'])) {
                  foreach ($change['value']['contacts'] as $contact) {
                    if (isset($contact['wa_id']) && $contact['wa_id'] === $from) {
                      $contactName = isset($contact['profile']['name']) ? $contact['profile']['name'] : $from;
                      break;
                    }
                  }
                }
                
                logMessage("Message received - From: {$contactName} ({$from}), Type: {$type}, Text: {$messageText}");
                
                $messagesFile = __DIR__ . '/../data/whatsapp-messages.json';
                $messages = readJsonArrayFile($messagesFile);
                
                $messages[] = [
                  'id' => $messageId,
                  'from' => $from,
                  'fromName' => $contactName,
                  'type' => $type,
                  'text' => $messageText,
                  'timestamp' => $timestamp,
                  'receivedAt' => time(),
                ];
                
                if (count($messages) > 1000) {
                  $messages = array_slice($messages, -1000);
                }
                writeJsonArrayFile($messagesFile, $messages);
              }
            }

            if (isset($change['value']['statuses']) && is_array($change['value']['statuses'])) {
              $statusesFile = __DIR__ . '/../data/whatsapp-statuses.json';
              $statusEvents = readJsonArrayFile($statusesFile);

              foreach ($change['value']['statuses'] as $status) {
                $statusValue = isset($status['status']) ? strtolower((string)$status['status']) : 'unknown';
                $wamid = isset($status['id']) ? (string)$status['id'] : '';
                $recipientId = isset($status['recipient_id']) ? (string)$status['recipient_id'] : '';
                $timestamp = isset($status['timestamp']) ? intval($status['timestamp']) : time();
                $conversationId = isset($status['conversation']['id']) ? (string)$status['conversation']['id'] : '';
                $conversationOrigin = isset($status['conversation']['origin']['type']) ? (string)$status['conversation']['origin']['type'] : '';
                $pricingCategory = isset($status['pricing']['category']) ? (string)$status['pricing']['category'] : '';
                $pricingModel = isset($status['pricing']['pricing_model']) ? (string)$status['pricing']['pricing_model'] : '';
                $errorCode = isset($status['errors'][0]['code']) ? $status['errors'][0]['code'] : null;
                $errorTitle = isset($status['errors'][0]['title']) ? (string)$status['errors'][0]['title'] : '';
                $errorMessage = isset($status['errors'][0]['message']) ? (string)$status['errors'][0]['message'] : '';

                logMessage("Status event - To: {$recipientId}, Status: {$statusValue}, WAMID: {$wamid}" . ($errorTitle ? ", Error: {$errorTitle}" : ''));

                $statusEvents[] = [
                  'id' => uniqid('wa_status_', true),
                  'wamid' => $wamid,
                  'recipient_id' => $recipientId,
                  'status' => $statusValue,
                  'timestamp' => $timestamp,
                  'receivedAt' => time(),
                  'conversationId' => $conversationId,
                  'conversationOriginType' => $conversationOrigin,
                  'pricingCategory' => $pricingCategory,
                  'pricingModel' => $pricingModel,
                  'errorCode' => $errorCode,
                  'errorTitle' => $errorTitle,
                  'errorMessage' => $errorMessage,
                  'raw' => $status,
                ];
              }

              if (count($statusEvents) > 5000) {
                $statusEvents = array_slice($statusEvents, -5000);
              }
              writeJsonArrayFile($statusesFile, $statusEvents);
            }
          }
        }
      }
    }
  }
  
  logMessage("Webhook processed successfully");
  respond(['success' => true, 'status' => 'received']);
}

logMessage("Unsupported method: " . $_SERVER['REQUEST_METHOD']);
respond(['success' => false, 'error' => 'Method not supported'], 405);
