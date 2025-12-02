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
$emailData = isset($body['emailData']) ? $body['emailData'] : null;
$recipients = isset($body['recipients']) ? $body['recipients'] : [];

if (!$smtpConfig || !$emailData || empty($recipients)) {
  respond(['success' => false, 'error' => 'Missing required fields'], 400);
}

require_once __DIR__ . '/phpmailer/PHPMailerAutoload.php';

$results = [
  'success' => 0,
  'failed' => 0,
  'errors' => [],
];

foreach ($recipients as $recipient) {
  try {
    $mail = new PHPMailer(true);
    
    $mail->isSMTP();
    $mail->Host = $smtpConfig['host'];
    $mail->Port = intval($smtpConfig['port']);
    $mail->SMTPAuth = true;
    $mail->Username = $smtpConfig['username'];
    $mail->Password = $smtpConfig['password'];
    $mail->SMTPSecure = (intval($smtpConfig['port']) === 465) ? 'ssl' : 'tls';
    $mail->CharSet = 'UTF-8';
    
    $mail->setFrom($emailData['senderEmail'], $emailData['senderName']);
    $mail->addAddress($recipient['email'], $recipient['name']);
    
    $mail->Subject = $emailData['subject'];
    
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
          $mail->addStringAttachment(
            base64_decode($attachment['content']),
            $attachment['filename'],
            'base64',
            isset($attachment['contentType']) ? $attachment['contentType'] : 'application/octet-stream'
          );
        }
      }
    }
    
    $mail->send();
    $results['success']++;
  } catch (Exception $e) {
    $results['failed']++;
    $results['errors'][] = $recipient['name'] . ': ' . $e->getMessage();
  }
}

respond([
  'success' => true,
  'results' => $results,
]);
