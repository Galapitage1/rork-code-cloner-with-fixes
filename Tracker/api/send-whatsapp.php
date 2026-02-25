<?php
error_reporting(E_ALL);
ini_set('display_errors', '1');
ini_set('log_errors', '1');
set_time_limit(300);
ini_set('max_execution_time', '300');

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
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  flush();
  exit;
}

function logError($message) {
  error_log('[WhatsApp Send] ' . $message);
}

set_error_handler(function($errno, $errstr, $errfile, $errline) {
  logError("PHP Error [$errno]: $errstr in $errfile:$errline");
  respond(['success' => false, 'error' => 'Server error: ' . $errstr], 500);
});

set_exception_handler(function($e) {
  logError('Uncaught exception: ' . $e->getMessage());
  respond(['success' => false, 'error' => 'Server exception: ' . $e->getMessage()], 500);
});

register_shutdown_function(function() {
  $error = error_get_last();
  if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR])) {
    logError('Fatal error: ' . json_encode($error));
    respond(['success' => false, 'error' => 'Server fatal error: ' . $error['message']], 500);
  }
});

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

$accessToken = isset($body['accessToken']) ? trim($body['accessToken']) : '';
$phoneNumberId = isset($body['phoneNumberId']) ? trim($body['phoneNumberId']) : '';
$message = isset($body['message']) ? trim($body['message']) : '';
$recipients = isset($body['recipients']) ? $body['recipients'] : [];
$mediaUrl = isset($body['mediaUrl']) ? trim($body['mediaUrl']) : '';
$mediaType = isset($body['mediaType']) ? trim($body['mediaType']) : 'image';
$caption = isset($body['caption']) ? trim($body['caption']) : '';
$useTemplate = !empty($body['useTemplate']);
$templateName = isset($body['templateName']) ? trim((string)$body['templateName']) : '';
$templateLanguage = isset($body['templateLanguage']) ? trim((string)$body['templateLanguage']) : 'en_US';
$templateParameters = isset($body['templateParameters']) && is_array($body['templateParameters']) ? $body['templateParameters'] : [];
$templateHeaderParameters = isset($body['templateHeaderParameters']) && is_array($body['templateHeaderParameters']) ? $body['templateHeaderParameters'] : [];
$templateHeaderMediaUrl = isset($body['templateHeaderMediaUrl']) ? trim((string)$body['templateHeaderMediaUrl']) : '';
$templateHeaderMediaType = isset($body['templateHeaderMediaType']) ? trim((string)$body['templateHeaderMediaType']) : 'image';
$templateButtonParameters = isset($body['templateButtonParameters']) && is_array($body['templateButtonParameters']) ? $body['templateButtonParameters'] : [];
$defaultCountryCode = isset($body['defaultCountryCode']) ? preg_replace('/[^0-9]/', '', trim((string)$body['defaultCountryCode'])) : '94';

if (!empty($mediaUrl)) {
  if (!filter_var($mediaUrl, FILTER_VALIDATE_URL)) {
    respond(['success' => false, 'error' => 'Invalid media URL format'], 400);
  }
  if (strpos($mediaUrl, 'https://') !== 0) {
    respond(['success' => false, 'error' => 'Media URL must use HTTPS'], 400);
  }
}

if (!empty($templateHeaderMediaUrl)) {
  if (!filter_var($templateHeaderMediaUrl, FILTER_VALIDATE_URL)) {
    respond(['success' => false, 'error' => 'Invalid template header media URL format'], 400);
  }
  if (strpos($templateHeaderMediaUrl, 'https://') !== 0) {
    respond(['success' => false, 'error' => 'Template header media URL must use HTTPS'], 400);
  }
}

if (empty($accessToken) || empty($phoneNumberId) || empty($recipients)) {
  respond(['success' => false, 'error' => 'Missing required fields'], 400);
}

if ($useTemplate && $templateName === '') {
  respond(['success' => false, 'error' => 'Template name is required when template mode is enabled'], 400);
}

if (!$useTemplate && empty($message) && empty($mediaUrl)) {
  respond(['success' => false, 'error' => 'Either message or media URL is required'], 400);
}

$results = [
  'success' => 0,
  'failed' => 0,
  'errors' => [],
  'skipped' => 0,
  'accepted' => 0,
  'delivery_pending' => 0,
];
$debug = [
  'mode' => $useTemplate ? 'template' : (!empty($mediaUrl) ? 'media' : 'text'),
  'template' => $useTemplate ? [
    'name' => $templateName,
    'language' => $templateLanguage !== '' ? $templateLanguage : 'en_US',
    'parameterCount' => count($templateParameters),
    'headerParameterCount' => count($templateHeaderParameters),
    'headerMediaUrl' => $templateHeaderMediaUrl,
    'headerMediaType' => $templateHeaderMediaType,
    'buttonParameterCount' => count($templateButtonParameters),
    'parameters' => array_values(array_filter(array_map(function($param) {
      if (is_array($param)) {
        return '';
      }
      return trim((string)$param);
    }, $templateParameters), function($value) {
      return $value !== '';
    })),
    'headerParameters' => array_values(array_filter(array_map(function($param) {
      if (is_array($param)) {
        return '';
      }
      return trim((string)$param);
    }, $templateHeaderParameters), function($value) {
      return $value !== '';
    })),
    'buttonParameters' => array_values(array_filter(array_map(function($param) {
      if (is_array($param)) {
        return '';
      }
      return trim((string)$param);
    }, $templateButtonParameters), function($value) {
      return $value !== '';
    })),
  ] : null,
  'defaultCountryCode' => $defaultCountryCode,
  'recipients' => [],
];

logError('Starting to send to ' . count($recipients) . ' recipients');
$batchStartTime = time();

function normalizePhoneNumber($rawPhone, $defaultCountryCode = '') {
  $phone = trim((string)$rawPhone);
  if ($phone === '') {
    return '';
  }

  $phone = preg_replace('/[^0-9+]/', '', $phone);
  if ($phone === '') {
    return '';
  }

  if (strpos($phone, '00') === 0) {
    $phone = substr($phone, 2);
  }

  if (strpos($phone, '+') === 0) {
    $phone = substr($phone, 1);
  }

  if (strpos($phone, '0') === 0 && !empty($defaultCountryCode)) {
    $phone = $defaultCountryCode . ltrim($phone, '0');
  }

  return preg_replace('/[^0-9]/', '', $phone);
}

foreach ($recipients as $index => $recipient) {
  if (time() - $batchStartTime > 280) {
    logError('Approaching timeout limit, stopping at recipient ' . ($index + 1));
    $results['errors'][] = 'Stopped early to avoid timeout. Sent to ' . ($index) . ' recipients.';
    break;
  }
  try {
    if (!isset($recipient['phone']) || empty($recipient['phone'])) {
      $results['skipped']++;
      if (count($results['errors']) < 50) {
        $results['errors'][] = ($recipient['name'] ?? 'Unknown') . ': No phone number';
      }
      continue;
    }

    $phone = normalizePhoneNumber($recipient['phone'], $defaultCountryCode);
    $debugRecipient = [
      'name' => isset($recipient['name']) ? (string)$recipient['name'] : 'Unknown',
      'inputPhone' => isset($recipient['phone']) ? (string)$recipient['phone'] : '',
      'normalizedPhone' => $phone,
    ];
    
    if (empty($phone)) {
      $results['skipped']++;
      $debugRecipient['result'] = 'skipped';
      $debugRecipient['reason'] = 'invalid_phone_number_format';
      if (count($debug['recipients']) < 50) {
        $debug['recipients'][] = $debugRecipient;
      }
      if (count($results['errors']) < 50) {
        $results['errors'][] = ($recipient['name'] ?? 'Unknown') . ': Invalid phone number format';
      }
      continue;
    }
    
    if (strlen($phone) < 8) {
      $results['skipped']++;
      $debugRecipient['result'] = 'skipped';
      $debugRecipient['reason'] = 'phone_number_too_short';
      if (count($debug['recipients']) < 50) {
        $debug['recipients'][] = $debugRecipient;
      }
      if (count($results['errors']) < 50) {
        $results['errors'][] = ($recipient['name'] ?? 'Unknown') . ': Phone number too short';
      }
      continue;
    }

    $url = "https://graph.facebook.com/v21.0/{$phoneNumberId}/messages";
    
    if ($useTemplate) {
      $template = [
        'name' => $templateName,
        'language' => [
          'code' => $templateLanguage !== '' ? $templateLanguage : 'en_US',
        ],
      ];

      $components = [];
      $headerParams = [];
      foreach ($templateHeaderParameters as $param) {
        if (is_array($param)) {
          continue;
        }
        $paramText = trim((string)$param);
        if ($paramText === '') {
          continue;
        }
        $headerParams[] = [
          'type' => 'text',
          'text' => $paramText,
        ];
      }
      if (!empty($templateHeaderMediaUrl)) {
        $headerMediaType = in_array($templateHeaderMediaType, ['image', 'video', 'document'], true) ? $templateHeaderMediaType : 'image';
        $components[] = [
          'type' => 'header',
          'parameters' => [[
            'type' => $headerMediaType,
            $headerMediaType => [
              'link' => $templateHeaderMediaUrl,
            ],
          ]],
        ];
      } elseif (!empty($headerParams)) {
        $components[] = [
          'type' => 'header',
          'parameters' => $headerParams,
        ];
      }

      $textParams = [];
      foreach ($templateParameters as $param) {
        if (is_array($param)) {
          continue;
        }
        $paramText = trim((string)$param);
        if ($paramText === '') {
          continue;
        }
        $textParams[] = [
          'type' => 'text',
          'text' => $paramText,
        ];
      }
      if (!empty($textParams)) {
        $components[] = [
          'type' => 'body',
          'parameters' => $textParams,
        ];
      }

      $buttonIndex = 0;
      foreach ($templateButtonParameters as $buttonParam) {
        if (is_array($buttonParam)) {
          $buttonIndex++;
          continue;
        }
        $buttonText = trim((string)$buttonParam);
        if ($buttonText === '') {
          $buttonIndex++;
          continue;
        }
        $components[] = [
          'type' => 'button',
          'sub_type' => 'url',
          'index' => (string)$buttonIndex,
          'parameters' => [[
            'type' => 'text',
            'text' => $buttonText,
          ]],
        ];
        $buttonIndex++;
      }

      if (!empty($components)) {
        $template['components'] = $components;
      }

      $payload = json_encode([
        'messaging_product' => 'whatsapp',
        'recipient_type' => 'individual',
        'to' => $phone,
        'type' => 'template',
        'template' => $template,
      ]);
    } elseif (!empty($mediaUrl)) {
      $messageBody = [
        'messaging_product' => 'whatsapp',
        'recipient_type' => 'individual',
        'to' => $phone,
        'type' => $mediaType,
      ];
      
      $messageBody[$mediaType] = ['link' => $mediaUrl];
      
      if (!empty($caption) && in_array($mediaType, ['image', 'video', 'document'])) {
        $messageBody[$mediaType]['caption'] = $caption;
      }
      
      $payload = json_encode($messageBody);
    } else {
      $payload = json_encode([
        'messaging_product' => 'whatsapp',
        'recipient_type' => 'individual',
        'to' => $phone,
        'type' => 'text',
        'text' => [
          'preview_url' => false,
          'body' => $message,
        ],
      ]);
    }

    $ch = curl_init();
    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_POST, true);
    curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    curl_setopt($ch, CURLOPT_HTTPHEADER, [
      "Authorization: Bearer {$accessToken}",
      'Content-Type: application/json',
    ]);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
    curl_setopt($ch, CURLOPT_TIMEOUT, 30);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $curlError = curl_error($ch);
    curl_close($ch);

    if ($curlError) {
      $results['failed']++;
      $debugRecipient['result'] = 'api_rejected';
      $debugRecipient['reason'] = 'curl_error';
      $debugRecipient['error'] = $curlError;
      if (count($debug['recipients']) < 50) {
        $debug['recipients'][] = $debugRecipient;
      }
      if (count($results['errors']) < 50) {
        $results['errors'][] = ($recipient['name'] ?? 'Unknown') . ": {$curlError}";
      }
      logError("CURL error for {$recipient['name']}: {$curlError}");
      continue;
    }

    $data = json_decode($response, true);

    if ($httpCode !== 200 || isset($data['error'])) {
      $errorMsg = isset($data['error']['message']) ? $data['error']['message'] : 'Failed to send message';
      $results['failed']++;
      $debugRecipient['result'] = 'api_rejected';
      $debugRecipient['httpCode'] = $httpCode;
      $debugRecipient['error'] = $errorMsg;
      if (isset($data['error']['code'])) {
        $debugRecipient['errorCode'] = $data['error']['code'];
      }
      if (count($debug['recipients']) < 50) {
        $debug['recipients'][] = $debugRecipient;
      }
      if (count($results['errors']) < 50) {
        $results['errors'][] = ($recipient['name'] ?? 'Unknown') . ": {$errorMsg} (HTTP {$httpCode})";
      }
      logError("Failed for {$recipient['name']} ({$phone}): {$errorMsg}. HTTP {$httpCode}. Response: {$response}");
    } else {
      $results['accepted']++;
      $messageStatus = isset($data['messages'][0]['message_status']) ? strtolower((string)$data['messages'][0]['message_status']) : '';
      $debugRecipient['result'] = 'accepted';
      $debugRecipient['messageStatus'] = $messageStatus !== '' ? $messageStatus : 'accepted';
      if (isset($data['messages'][0]['id'])) {
        $debugRecipient['wamid'] = (string)$data['messages'][0]['id'];
      }
      if (count($debug['recipients']) < 50) {
        $debug['recipients'][] = $debugRecipient;
      }
      if ($messageStatus === 'accepted' || $messageStatus === '') {
        $results['delivery_pending']++;
      }
      $results['success']++;
      if (($index + 1) % 50 === 0) {
        logError("Progress: Successfully sent to {$results['success']} recipients");
      }
    }

    if (($index + 1) % 100 === 0) {
      usleep(2000000);
    } else {
      usleep(500000);
    }
  } catch (Exception $e) {
    $results['failed']++;
    if (count($debug['recipients']) < 50) {
      $debug['recipients'][] = [
        'name' => isset($recipient['name']) ? (string)$recipient['name'] : 'Unknown',
        'inputPhone' => isset($recipient['phone']) ? (string)$recipient['phone'] : '',
        'normalizedPhone' => isset($phone) ? (string)$phone : '',
        'result' => 'exception',
        'error' => $e->getMessage(),
      ];
    }
    if (count($results['errors']) < 50) {
      $results['errors'][] = ($recipient['name'] ?? 'Unknown') . ": Unexpected error - " . $e->getMessage();
    }
    logError("Exception for {$recipient['name']}: " . $e->getMessage());
    continue;
  }
}

logError('Finished sending. Success: ' . $results['success'] . ', Failed: ' . $results['failed'] . ', Skipped: ' . $results['skipped']);

if (count($results['errors']) >= 50) {
  $results['errors'][] = '... and more errors (showing first 50)';
}

respond([
  'success' => true,
  'results' => $results,
  'debug' => $debug,
  'deliveryNote' => 'Success means WhatsApp accepted the request. Final delivery status is confirmed via webhook events.',
]);
