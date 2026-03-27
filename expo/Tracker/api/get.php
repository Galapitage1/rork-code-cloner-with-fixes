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

require_once __DIR__ . '/dialog_esms_service.php';

function upgrade_esms_fields_in_record($endpoint, $item, &$changed) {
  if (!is_array($item)) {
    return $item;
  }

  $encryptValue = function($value) {
    $raw = is_string($value) ? trim($value) : '';
    if ($raw === '') {
      return '';
    }
    if (function_exists('dialog_esms_encrypt_secret')) {
      return dialog_esms_encrypt_secret($raw);
    }
    return $raw;
  };

  if ($endpoint === 'sms_provider_settings') {
    if (isset($item['esms_password']) && is_string($item['esms_password']) && trim($item['esms_password']) !== '') {
      $encrypted = $encryptValue($item['esms_password']);
      if (!isset($item['esms_password_encrypted']) || $item['esms_password_encrypted'] !== $encrypted) {
        $item['esms_password_encrypted'] = $encrypted;
        $changed = true;
      }
    }
    if (isset($item['esms_password_encrypted']) && is_string($item['esms_password_encrypted'])) {
      $encrypted = $encryptValue($item['esms_password_encrypted']);
      if ($item['esms_password_encrypted'] !== $encrypted) {
        $item['esms_password_encrypted'] = $encrypted;
        $changed = true;
      }
    }
    if (isset($item['esms_password'])) {
      unset($item['esms_password']);
      $changed = true;
    }
  }

  if ($endpoint === 'campaign_settings') {
    if (isset($item['esms_password']) && is_string($item['esms_password']) && trim($item['esms_password']) !== '') {
      $encrypted = $encryptValue($item['esms_password']);
      if (!isset($item['esms_password_encrypted']) || $item['esms_password_encrypted'] !== $encrypted) {
        $item['esms_password_encrypted'] = $encrypted;
        $changed = true;
      }
    }
    if (isset($item['esms_password_encrypted']) && is_string($item['esms_password_encrypted'])) {
      $encrypted = $encryptValue($item['esms_password_encrypted']);
      if ($item['esms_password_encrypted'] !== $encrypted) {
        $item['esms_password_encrypted'] = $encrypted;
        $changed = true;
      }
    }
    if (isset($item['esms_password'])) {
      unset($item['esms_password']);
      $changed = true;
    }

    if (isset($item['dialogSMSSettings']) && is_array($item['dialogSMSSettings'])) {
      if (isset($item['dialogSMSSettings']['esms_password']) && is_string($item['dialogSMSSettings']['esms_password']) && trim($item['dialogSMSSettings']['esms_password']) !== '') {
        $encrypted = $encryptValue($item['dialogSMSSettings']['esms_password']);
        if (!isset($item['dialogSMSSettings']['esms_password_encrypted']) || $item['dialogSMSSettings']['esms_password_encrypted'] !== $encrypted) {
          $item['dialogSMSSettings']['esms_password_encrypted'] = $encrypted;
          $changed = true;
        }
      }
      if (isset($item['dialogSMSSettings']['esms_password_encrypted']) && is_string($item['dialogSMSSettings']['esms_password_encrypted'])) {
        $encrypted = $encryptValue($item['dialogSMSSettings']['esms_password_encrypted']);
        if ($item['dialogSMSSettings']['esms_password_encrypted'] !== $encrypted) {
          $item['dialogSMSSettings']['esms_password_encrypted'] = $encrypted;
          $changed = true;
        }
      }
      if (isset($item['dialogSMSSettings']['esms_password'])) {
        unset($item['dialogSMSSettings']['esms_password']);
        $changed = true;
      }
    }
  }

  return $item;
}

function upgrade_sensitive_endpoint_data($endpoint, $data, &$changed) {
  if (!in_array($endpoint, ['sms_provider_settings', 'campaign_settings'], true)) {
    return $data;
  }
  if (!is_array($data)) {
    return $data;
  }

  $isSequential = array_keys($data) === range(0, count($data) - 1);
  if ($isSequential) {
    foreach ($data as $index => $item) {
      if (!is_array($item)) {
        continue;
      }
      $data[$index] = upgrade_esms_fields_in_record($endpoint, $item, $changed);
    }
    return $data;
  }

  return upgrade_esms_fields_in_record($endpoint, $data, $changed);
}

function persist_json_array($filePath, $data) {
  $fp = @fopen($filePath, 'c+');
  if ($fp === false) {
    return;
  }
  if (!@flock($fp, LOCK_EX)) {
    @fclose($fp);
    return;
  }
  @ftruncate($fp, 0);
  @rewind($fp);
  @fwrite($fp, json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
  @fflush($fp);
  @flock($fp, LOCK_UN);
  @fclose($fp);
  @chmod($filePath, 0644);
}

// Support incremental sync with 'since' parameter
$since = isset($_GET['since']) && is_numeric($_GET['since']) ? intval($_GET['since']) : 0;

// Support lightweight recovery pulls with a minDays filter
$minDays = isset($_GET['minDays']) && is_numeric($_GET['minDays']) ? intval($_GET['minDays']) : 0;

// Support fetching deleted items explicitly
$includeDeleted = isset($_GET['includeDeleted']) && $_GET['includeDeleted'] === 'true';

$dataDir = __DIR__ . '/../data';
$filePath = $dataDir . '/' . $endpoint . '.json';

if (!file_exists($filePath)) { respond([]); }

$contents = file_get_contents($filePath);
$decoded = json_decode($contents, true);
if (!is_array($decoded)) { respond([]); }

$wasChanged = false;
$decoded = upgrade_sensitive_endpoint_data($endpoint, $decoded, $wasChanged);
if ($wasChanged) {
  persist_json_array($filePath, $decoded);
}

// If 'since' parameter is provided, filter to only items updated after that timestamp
if ($since > 0) {
  $filtered = array_filter($decoded, function($item) use ($since, $includeDeleted) {
    $updatedAt = isset($item['updatedAt']) && is_numeric($item['updatedAt']) ? intval($item['updatedAt']) : 0;
    $isDeleted = isset($item['deleted']) && $item['deleted'] === true;
    
    // If not including deleted, skip deleted items
    if (!$includeDeleted && $isDeleted) {
      return false;
    }
    
    return $updatedAt > $since;
  });
  respond(array_values($filtered));
} else if ($minDays > 0) {
  $cutoffTimestamp = (time() * 1000) - ($minDays * 24 * 60 * 60 * 1000);
  $filtered = array_filter($decoded, function($item) use ($cutoffTimestamp, $includeDeleted) {
    if (!is_array($item)) {
      return false;
    }

    $isDeleted = isset($item['deleted']) && $item['deleted'] === true;
    if (!$includeDeleted && $isDeleted) {
      return false;
    }

    if (!isset($item['updatedAt']) || !is_numeric($item['updatedAt'])) {
      // Keep undated rows so master/current records are not lost during restore.
      return true;
    }

    return intval($item['updatedAt']) >= $cutoffTimestamp;
  });
  respond(array_values($filtered));
} else {
  // When includeDeleted is true, return ALL items including deleted ones
  // When false, filter out deleted items (default behavior for normal sync)
  if ($includeDeleted) {
    // Return everything including deleted items
    respond($decoded);
  } else {
    // Normal behavior - return all items (deleted items are soft-deleted with flag)
    // The client will handle filtering based on deleted flag
    respond($decoded);
  }
}
