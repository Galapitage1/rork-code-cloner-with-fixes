<?php
error_reporting(E_ALL);
ini_set('display_errors', '0');
ini_set('log_errors', '1');
set_time_limit(900);
ignore_user_abort(true);

header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type, Authorization');
header('Content-Type: application/json; charset=utf-8');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
  http_response_code(204);
  exit;
}

function respond($data, $status = 200) {
  if (!headers_sent()) {
    header('Content-Type: application/json; charset=utf-8');
  }
  http_response_code($status);
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function email_log($message) {
  error_log('[Email Send] ' . $message);
}

set_error_handler(function($errno, $errstr, $errfile, $errline) {
  email_log("PHP Error [$errno]: $errstr in $errfile:$errline");
  respond(['success' => false, 'error' => 'Server error: ' . $errstr], 500);
});

set_exception_handler(function($e) {
  email_log('Uncaught exception: ' . $e->getMessage());
  respond(['success' => false, 'error' => 'Server exception: ' . $e->getMessage()], 500);
});

register_shutdown_function(function() {
  $error = error_get_last();
  if ($error && in_array($error['type'], [E_ERROR, E_PARSE, E_CORE_ERROR, E_COMPILE_ERROR], true)) {
    email_log('Fatal error: ' . json_encode($error));
    if (!headers_sent()) {
      header('Content-Type: application/json; charset=utf-8');
    }
    http_response_code(500);
    echo json_encode([
      'success' => false,
      'error' => 'Server fatal error: ' . $error['message'],
    ], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
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

$smtpConfig = isset($body['smtpConfig']) ? $body['smtpConfig'] : null;
$emailData = isset($body['emailData']) ? $body['emailData'] : null;
$recipients = isset($body['recipients']) ? $body['recipients'] : [];

if (!$smtpConfig || !$emailData || empty($recipients)) {
  respond(['success' => false, 'error' => 'Missing required fields'], 400);
}

function encode_header_utf8($value) {
  return '=?UTF-8?B?' . base64_encode($value) . '?=';
}

function sanitize_email($email) {
  return filter_var(trim((string)$email), FILTER_VALIDATE_EMAIL) ?: '';
}

function recipient_value($recipient, $key) {
  return isset($recipient[$key]) ? trim((string)$recipient[$key]) : '';
}

function first_name_from_name($name) {
  $name = trim((string)$name);
  if ($name === '') return '';
  $parts = preg_split('/\s+/', $name);
  return isset($parts[0]) ? $parts[0] : '';
}

function personalize_text($text, $recipient) {
  $text = (string)$text;
  $name = recipient_value($recipient, 'name');
  $firstName = recipient_value($recipient, 'first_name');
  if ($firstName === '') {
    $firstName = first_name_from_name($name);
  }
  $company = recipient_value($recipient, 'company');
  $email = recipient_value($recipient, 'email');
  $phone = recipient_value($recipient, 'phone');

  $replacements = [
    '{{name}}' => $name,
    '{{first_name}}' => $firstName,
    '{{company}}' => $company,
    '{{email}}' => $email,
    '{{phone}}' => $phone,
  ];

  return strtr($text, $replacements);
}

function personalize_email_data($emailData, $recipient) {
  $personalized = $emailData;
  $personalized['subject'] = personalize_text(isset($emailData['subject']) ? $emailData['subject'] : '', $recipient);
  $personalized['message'] = personalize_text(isset($emailData['message']) ? $emailData['message'] : '', $recipient);
  $personalized['htmlContent'] = personalize_text(isset($emailData['htmlContent']) ? $emailData['htmlContent'] : '', $recipient);
  return $personalized;
}

function build_common_email_headers($host, $senderEmail, $senderName, $replyToEmail, $replyToName, $toEmail, $toName, $subject) {
  $safeHost = preg_replace('/[^a-zA-Z0-9\.\-]/', '', (string)$host);
  if ($safeHost === '') {
    $safeHost = 'tracker.tecclk.com';
  }

  $fromDisplay = $senderName !== '' ? encode_header_utf8($senderName) . " <{$senderEmail}>" : $senderEmail;
  $replyEmail = sanitize_email($replyToEmail);
  if ($replyEmail === '') {
    $replyEmail = $senderEmail;
  }
  $replyName = trim((string)$replyToName);
  if ($replyName === '') {
    $replyName = $senderName;
  }
  $toDisplay = $toName !== '' ? encode_header_utf8($toName) . " <{$toEmail}>" : $toEmail;
  $messageId = '<' . uniqid('tracker_', true) . '@' . $safeHost . '>';
  $listUnsub = '<mailto:' . $senderEmail . '?subject=' . rawurlencode('unsubscribe') . '>';
  $replyDisplay = $replyName !== '' ? encode_header_utf8($replyName) . " <{$replyEmail}>" : $replyEmail;

  return [
    'Date: ' . date(DATE_RFC2822),
    'From: ' . $fromDisplay,
    'To: ' . $toDisplay,
    'Reply-To: ' . $replyDisplay,
    'Subject: ' . encode_header_utf8($subject),
    'Message-ID: ' . $messageId,
    'X-Mailer: Tracker SMTP',
    'List-Unsubscribe: ' . $listUnsub,
  ];
}

function build_email_message($emailData) {
  $format = isset($emailData['format']) ? $emailData['format'] : 'text';
  $messageText = isset($emailData['message']) ? (string)$emailData['message'] : '';
  $htmlContent = isset($emailData['htmlContent']) ? (string)$emailData['htmlContent'] : '';
  $attachments = (isset($emailData['attachments']) && is_array($emailData['attachments'])) ? $emailData['attachments'] : [];

  $hasAttachments = count($attachments) > 0;
  $hasHtml = ($format === 'html');

  $headers = [
    'MIME-Version: 1.0',
  ];

  if (!$hasAttachments && !$hasHtml) {
    $headers[] = 'Content-Type: text/plain; charset=UTF-8';
    $headers[] = 'Content-Transfer-Encoding: 8bit';
    return [$headers, $messageText];
  }

  $mixedBoundary = 'b1_' . md5(uniqid((string)mt_rand(), true));
  $altBoundary = 'b2_' . md5(uniqid((string)mt_rand(), true));
  $headers[] = 'Content-Type: multipart/mixed; boundary="' . $mixedBoundary . '"';

  $body = '';

  if ($hasHtml) {
    $plainAlt = trim(strip_tags($htmlContent));
    if ($plainAlt === '') {
      $plainAlt = $messageText;
    }
    $body .= "--{$mixedBoundary}\r\n";
    $body .= "Content-Type: multipart/alternative; boundary=\"{$altBoundary}\"\r\n\r\n";
    $body .= "--{$altBoundary}\r\n";
    $body .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
    $body .= $plainAlt . "\r\n\r\n";
    $body .= "--{$altBoundary}\r\n";
    $body .= "Content-Type: text/html; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
    $body .= $htmlContent . "\r\n\r\n";
    $body .= "--{$altBoundary}--\r\n";
  } else {
    $body .= "--{$mixedBoundary}\r\n";
    $body .= "Content-Type: text/plain; charset=UTF-8\r\n";
    $body .= "Content-Transfer-Encoding: 8bit\r\n\r\n";
    $body .= $messageText . "\r\n\r\n";
  }

  foreach ($attachments as $attachment) {
    if (!isset($attachment['content']) || !isset($attachment['filename'])) {
      continue;
    }
    $binary = base64_decode($attachment['content'], true);
    if ($binary === false) {
      continue;
    }
    $filename = str_replace(["\r", "\n", "\""], '', (string)$attachment['filename']);
    $contentType = isset($attachment['contentType']) ? (string)$attachment['contentType'] : 'application/octet-stream';

    $body .= "--{$mixedBoundary}\r\n";
    $body .= "Content-Type: {$contentType}; name=\"{$filename}\"\r\n";
    $body .= "Content-Transfer-Encoding: base64\r\n";
    $body .= "Content-Disposition: attachment; filename=\"{$filename}\"\r\n\r\n";
    $body .= chunk_split(base64_encode($binary)) . "\r\n";
  }

  $body .= "--{$mixedBoundary}--\r\n";
  return [$headers, $body];
}

function smtp_write_line($socket, $line) {
  $written = @fwrite($socket, $line . "\r\n");
  if ($written === false) {
    throw new Exception('SMTP write failed');
  }
}

function smtp_read_response($socket) {
  $response = '';
  while (!feof($socket)) {
    $line = fgets($socket, 515);
    if ($line === false) {
      break;
    }
    $response .= $line;
    if (preg_match('/^\d{3}\s/', $line)) {
      break;
    }
    if (!preg_match('/^\d{3}\-/', $line)) {
      break;
    }
  }
  return $response;
}

function smtp_expect($socket, $expectedCodes, $step) {
  $response = smtp_read_response($socket);
  $code = intval(substr(trim($response), 0, 3));
  $expected = is_array($expectedCodes) ? $expectedCodes : [$expectedCodes];
  if (!in_array($code, $expected, true)) {
    throw new Exception($step . ' failed: ' . trim($response));
  }
  return $response;
}

function smtp_send_via_socket($smtpConfig, $emailData, $toEmail, $toName, $senderEmail, $senderName, $replyToEmail, $replyToName, $subject) {
  $host = trim((string)($smtpConfig['host'] ?? ''));
  $port = intval($smtpConfig['port'] ?? 587);
  $username = trim((string)($smtpConfig['username'] ?? ''));
  $password = (string)($smtpConfig['password'] ?? '');

  if ($host === '' || $username === '' || $password === '') {
    throw new Exception('SMTP settings incomplete');
  }

  $transport = ($port === 465) ? 'ssl' : 'tcp';
  $remote = $transport . '://' . $host . ':' . $port;
  $context = stream_context_create([
    'ssl' => [
      'verify_peer' => false,
      'verify_peer_name' => false,
      'allow_self_signed' => true,
    ],
  ]);

  $errno = 0;
  $errstr = '';
  $socket = @stream_socket_client($remote, $errno, $errstr, 20, STREAM_CLIENT_CONNECT, $context);
  if (!$socket) {
    throw new Exception("Cannot connect to SMTP server: {$errstr} ({$errno})");
  }

  stream_set_timeout($socket, 20);

  try {
    smtp_expect($socket, [220], 'SMTP greeting');

    $ehloHost = isset($_SERVER['SERVER_NAME']) && $_SERVER['SERVER_NAME'] ? $_SERVER['SERVER_NAME'] : 'tracker.tecclk.com';
    smtp_write_line($socket, 'EHLO ' . $ehloHost);
    $ehloResponse = smtp_expect($socket, [250], 'EHLO');

    if ($port !== 465 && stripos($ehloResponse, 'STARTTLS') !== false) {
      smtp_write_line($socket, 'STARTTLS');
      smtp_expect($socket, [220], 'STARTTLS');
      $cryptoOk = @stream_socket_enable_crypto($socket, true, STREAM_CRYPTO_METHOD_TLS_CLIENT);
      if (!$cryptoOk) {
        throw new Exception('STARTTLS negotiation failed');
      }
      smtp_write_line($socket, 'EHLO ' . $ehloHost);
      smtp_expect($socket, [250], 'EHLO after STARTTLS');
    }

    smtp_write_line($socket, 'AUTH LOGIN');
    smtp_expect($socket, [334], 'AUTH LOGIN');
    smtp_write_line($socket, base64_encode($username));
    smtp_expect($socket, [334], 'SMTP username');
    smtp_write_line($socket, base64_encode($password));
    smtp_expect($socket, [235], 'SMTP password');

    smtp_write_line($socket, 'MAIL FROM:<' . $senderEmail . '>');
    smtp_expect($socket, [250], 'MAIL FROM');
    smtp_write_line($socket, 'RCPT TO:<' . $toEmail . '>');
    smtp_expect($socket, [250, 251], 'RCPT TO');
    smtp_write_line($socket, 'DATA');
    smtp_expect($socket, [354], 'DATA');

    list($mimeHeaders, $mimeBody) = build_email_message($emailData);

    $dataHeaders = array_merge(
      build_common_email_headers($host, $senderEmail, $senderName, $replyToEmail, $replyToName, $toEmail, $toName, $subject),
      $mimeHeaders
    );

    $messageData = implode("\r\n", $dataHeaders) . "\r\n\r\n" . $mimeBody;
    $messageData = str_replace(["\r\n", "\r"], "\n", $messageData);
    $messageData = str_replace("\n", "\r\n", $messageData);
    $messageData = preg_replace('/(^|\r\n)\./', '$1..', $messageData);

    $written = @fwrite($socket, $messageData . "\r\n.\r\n");
    if ($written === false) {
      throw new Exception('SMTP DATA write failed');
    }
    smtp_expect($socket, [250], 'SMTP send');

    smtp_write_line($socket, 'QUIT');
    // Some servers close immediately; ignore QUIT response failures.
    @smtp_read_response($socket);
  } finally {
    fclose($socket);
  }
}

$canUsePHPMailer = file_exists(__DIR__ . '/phpmailer/PHPMailerAutoload.php');
if ($canUsePHPMailer) {
  require_once __DIR__ . '/phpmailer/PHPMailerAutoload.php';
  $canUsePHPMailer = class_exists('PHPMailer');
}

$results = [
  'success' => 0,
  'failed' => 0,
  'errors' => [],
];

$usedSmtpSocket = false;
$usedNativeMailFallback = false;

foreach ($recipients as $recipient) {
  try {
    $toEmail = sanitize_email(isset($recipient['email']) ? $recipient['email'] : '');
    $toName = isset($recipient['name']) ? trim((string)$recipient['name']) : '';
    $senderEmail = sanitize_email(isset($emailData['senderEmail']) ? $emailData['senderEmail'] : '');
    $senderName = isset($emailData['senderName']) ? trim((string)$emailData['senderName']) : '';
    $replyToEmail = sanitize_email(isset($emailData['replyToEmail']) ? $emailData['replyToEmail'] : '');
    $replyToName = isset($emailData['replyToName']) ? trim((string)$emailData['replyToName']) : '';
    $personalizedEmailData = personalize_email_data($emailData, $recipient);
    $subject = isset($personalizedEmailData['subject']) ? (string)$personalizedEmailData['subject'] : '';

    if ($replyToEmail === '') {
      $replyToEmail = $senderEmail;
    }
    if ($replyToName === '') {
      $replyToName = $senderName;
    }

    if ($toEmail === '' || $senderEmail === '') {
      throw new Exception('Invalid sender/recipient email');
    }

    if ($canUsePHPMailer) {
      $mail = new PHPMailer(true);
      $mail->isSMTP();
      $mail->Host = $smtpConfig['host'];
      $mail->Port = intval($smtpConfig['port']);
      $mail->SMTPAuth = true;
      $mail->Username = $smtpConfig['username'];
      $mail->Password = $smtpConfig['password'];
      $mail->SMTPSecure = (intval($smtpConfig['port']) === 465) ? 'ssl' : 'tls';
      $mail->CharSet = 'UTF-8';

      $mail->setFrom($senderEmail, $senderName);
      $mail->addAddress($toEmail, $toName);
      $mail->addReplyTo($replyToEmail, $replyToName);
      $mail->Subject = $subject;
      $mail->MessageID = '<' . uniqid('tracker_', true) . '@' . preg_replace('/[^a-zA-Z0-9\.\-]/', '', (string)$smtpConfig['host']) . '>';
      $mail->addCustomHeader('X-Mailer', 'Tracker SMTP');
      $mail->addCustomHeader('List-Unsubscribe', '<mailto:' . $senderEmail . '?subject=' . rawurlencode('unsubscribe') . '>');

      if (isset($personalizedEmailData['format']) && $personalizedEmailData['format'] === 'html') {
        $mail->isHTML(true);
        $mail->Body = isset($personalizedEmailData['htmlContent']) ? $personalizedEmailData['htmlContent'] : '';
        $mail->AltBody = strip_tags($mail->Body);
      } else {
        $mail->isHTML(false);
        $mail->Body = isset($personalizedEmailData['message']) ? $personalizedEmailData['message'] : '';
      }

      if (isset($personalizedEmailData['attachments']) && is_array($personalizedEmailData['attachments'])) {
        foreach ($personalizedEmailData['attachments'] as $attachment) {
          if (isset($attachment['content']) && isset($attachment['filename'])) {
            $decoded = base64_decode($attachment['content'], true);
            if ($decoded !== false) {
              $mail->addStringAttachment(
                $decoded,
                $attachment['filename'],
                'base64',
                isset($attachment['contentType']) ? $attachment['contentType'] : 'application/octet-stream'
              );
            }
          }
        }
      }

      $mail->send();
    } elseif (!empty($smtpConfig['host']) && !empty($smtpConfig['username']) && isset($smtpConfig['password'])) {
      $usedSmtpSocket = true;
      smtp_send_via_socket($smtpConfig, $personalizedEmailData, $toEmail, $toName, $senderEmail, $senderName, $replyToEmail, $replyToName, $subject);
    } else {
      $usedNativeMailFallback = true;
      list($mimeHeaders, $body) = build_email_message($personalizedEmailData);

      if ($toName !== '') {
        $toHeader = encode_header_utf8($toName) . " <{$toEmail}>";
      } else {
        $toHeader = $toEmail;
      }

      $commonHeaders = build_common_email_headers($smtpConfig['host'] ?? 'tracker.tecclk.com', $senderEmail, $senderName, $replyToEmail, $replyToName, $toEmail, $toName, $subject);
      $commonHeaders = array_values(array_filter($commonHeaders, function($h) {
        return stripos($h, 'To:') !== 0 && stripos($h, 'Subject:') !== 0;
      }));
      $headerLines = array_merge($commonHeaders, $mimeHeaders);
      $subjectHeader = encode_header_utf8($subject);
      $ok = @mail($toHeader, $subjectHeader, $body, implode("\r\n", $headerLines), '-f ' . $senderEmail);
      if (!$ok) {
        $ok = @mail($toHeader, $subjectHeader, $body, implode("\r\n", $headerLines));
      }
      if (!$ok) {
        $lastError = error_get_last();
        $msg = isset($lastError['message']) ? $lastError['message'] : 'mail() returned false';
        throw new Exception($msg);
      }
    }

    $results['success']++;
  } catch (Exception $e) {
    $results['failed']++;
    $results['errors'][] = $recipient['name'] . ': ' . $e->getMessage();
  }
}

respond([
  'success' => true,
  'results' => $results,
  'mailer' => $canUsePHPMailer ? 'phpmailer' : ($usedSmtpSocket ? 'smtp_socket' : 'php_mail_fallback'),
  'note' => $usedNativeMailFallback ? 'PHPMailer not installed and SMTP config missing. Sent using server mail() fallback.' : null,
]);
