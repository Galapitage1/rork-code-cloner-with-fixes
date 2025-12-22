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

$uploadDir = __DIR__ . '/../../uploads/';
if (!is_dir($uploadDir)) {
  if (!mkdir($uploadDir, 0755, true)) {
    respond(['success' => false, 'error' => 'Failed to create upload directory'], 500);
  }
}

$htaccessPath = $uploadDir . '.htaccess';
if (!file_exists($htaccessPath)) {
  $htaccessContent = "Options -Indexes\n<FilesMatch \"\\.(jpg|jpeg|png|gif|pdf|mp4|mp3|wav|doc|docx)$\">\n  Order Allow,Deny\n  Allow from all\n</FilesMatch>";
  file_put_contents($htaccessPath, $htaccessContent);
}

if (!isset($_FILES['file']) || $_FILES['file']['error'] !== UPLOAD_ERR_OK) {
  $errorMsg = isset($_FILES['file']) ? 'Upload error code: ' . $_FILES['file']['error'] : 'No file uploaded';
  respond(['success' => false, 'error' => $errorMsg], 400);
}

$file = $_FILES['file'];
$fileName = $file['name'];
$fileTmpPath = $file['tmp_name'];
$fileSize = $file['size'];
$fileType = $file['type'];

$maxSize = 16 * 1024 * 1024;
if ($fileSize > $maxSize) {
  respond(['success' => false, 'error' => 'File too large. Max 16MB'], 400);
}

$allowedTypes = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/mpeg', 'video/quicktime',
  'audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg',
  'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
];

if (!in_array($fileType, $allowedTypes)) {
  respond(['success' => false, 'error' => 'File type not allowed: ' . $fileType], 400);
}

$extension = strtolower(pathinfo($fileName, PATHINFO_EXTENSION));
$uniqueName = uniqid('media_', true) . '_' . time() . '.' . $extension;
$destPath = $uploadDir . $uniqueName;

if (!move_uploaded_file($fileTmpPath, $destPath)) {
  respond(['success' => false, 'error' => 'Failed to save file'], 500);
}

$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https' : 'http';
$host = $_SERVER['HTTP_HOST'];
$publicUrl = $protocol . '://' . $host . '/uploads/' . $uniqueName;

respond([
  'success' => true,
  'url' => $publicUrl,
  'filename' => $uniqueName,
  'size' => $fileSize,
  'type' => $fileType,
]);
