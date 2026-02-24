<?php
error_reporting(E_ALL);
ini_set('display_errors', '1');

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

$usedNativeMailFallback = false;

foreach ($recipients as $recipient) {
  try {
    $toEmail = sanitize_email(isset($recipient['email']) ? $recipient['email'] : '');
    $toName = isset($recipient['name']) ? trim((string)$recipient['name']) : '';
    $senderEmail = sanitize_email(isset($emailData['senderEmail']) ? $emailData['senderEmail'] : '');
    $senderName = isset($emailData['senderName']) ? trim((string)$emailData['senderName']) : '';
    $subject = isset($emailData['subject']) ? (string)$emailData['subject'] : '';

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
      $mail->Subject = $subject;

      if (isset($emailData['format']) && $emailData['format'] === 'html') {
        $mail->isHTML(true);
        $mail->Body = isset($emailData['htmlContent']) ? $emailData['htmlContent'] : '';
        $mail->AltBody = strip_tags($mail->Body);
      } else {
        $mail->isHTML(false);
        $mail->Body = isset($emailData['message']) ? $emailData['message'] : '';
      }

      if (isset($emailData['attachments']) && is_array($emailData['attachments'])) {
        foreach ($emailData['attachments'] as $attachment) {
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
    } else {
      $usedNativeMailFallback = true;
      list($mimeHeaders, $body) = build_email_message($emailData);

      $fromDisplay = $senderName !== ''
        ? encode_header_utf8($senderName) . " <{$senderEmail}>"
        : $senderEmail;

      $headers = array_merge($mimeHeaders, [
        'From: ' . $fromDisplay,
        'Reply-To: ' . $senderEmail,
      ]);

      if ($toName !== '') {
        $toHeader = encode_header_utf8($toName) . " <{$toEmail}>";
      } else {
        $toHeader = $toEmail;
      }

      $subjectHeader = encode_header_utf8($subject);
      $ok = @mail($toHeader, $subjectHeader, $body, implode("\r\n", $headers), '-f ' . $senderEmail);
      if (!$ok) {
        $ok = @mail($toHeader, $subjectHeader, $body, implode("\r\n", $headers));
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
  'mailer' => $canUsePHPMailer ? 'phpmailer' : 'php_mail_fallback',
  'note' => $usedNativeMailFallback ? 'PHPMailer not installed. Sent using server mail() fallback.' : null,
]);
