<?php
error_reporting(0);
ini_set('display_errors', '0');

function fb_send_cors(string $methods = 'GET, POST, OPTIONS'): void {
  header('Access-Control-Allow-Origin: *');
  header('Access-Control-Allow-Methods: ' . $methods);
  header('Access-Control-Allow-Headers: Content-Type, Authorization, X-Admin-Token');
}

function fb_preflight(string $methods = 'GET, POST, OPTIONS'): void {
  fb_send_cors($methods);
  if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(204);
    exit;
  }
}

function fb_respond($data, int $status = 200): void {
  http_response_code($status);
  header('Content-Type: application/json; charset=utf-8');
  echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function fb_data_dir(): string {
  $dir = __DIR__ . '/../data';
  if (!is_dir($dir)) {
    @mkdir($dir, 0755, true);
  }
  return $dir;
}

function fb_read_json(string $filename, $default = []) {
  $path = fb_data_dir() . '/' . $filename;
  if (!file_exists($path)) {
    return $default;
  }

  $raw = @file_get_contents($path);
  if ($raw === false || $raw === '') {
    return $default;
  }

  $decoded = json_decode($raw, true);
  return is_array($decoded) ? $decoded : $default;
}

function fb_write_json(string $filename, $data): bool {
  $path = fb_data_dir() . '/' . $filename;
  $encoded = json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_PRETTY_PRINT);
  if ($encoded === false) {
    return false;
  }

  $result = @file_put_contents($path, $encoded, LOCK_EX);
  if ($result === false) {
    return false;
  }

  @chmod($path, 0644);
  return true;
}

function fb_now_ms(): int {
  return (int) floor(microtime(true) * 1000);
}

function fb_iso_now(): string {
  return gmdate('c');
}

function fb_str($value, int $maxLen = 300): string {
  $text = is_string($value) ? trim($value) : '';
  if ($text === '') {
    return '';
  }
  if (function_exists('mb_substr')) {
    return mb_substr($text, 0, $maxLen);
  }
  return substr($text, 0, $maxLen);
}

function fb_int($value, int $min, int $max): ?int {
  if (!is_numeric($value)) {
    return null;
  }
  $n = (int) $value;
  if ($n < $min || $n > $max) {
    return null;
  }
  return $n;
}

function fb_bool($value): bool {
  return $value === true || $value === 1 || $value === '1' || $value === 'true';
}

function fb_get_request_json(): array {
  $raw = @file_get_contents('php://input');
  if (!$raw) {
    return [];
  }
  $body = json_decode($raw, true);
  return is_array($body) ? $body : [];
}

function fb_get_outlets(): array {
  $outlets = fb_read_json('outlets.json', []);
  $result = [];
  foreach ($outlets as $outlet) {
    if (!is_array($outlet)) {
      continue;
    }
    if (isset($outlet['deleted']) && $outlet['deleted'] === true) {
      continue;
    }
    $outletType = strtolower(fb_str($outlet['outletType'] ?? '', 20));
    if ($outletType !== 'sales') {
      continue;
    }

    $name = fb_str($outlet['name'] ?? '', 120);
    if ($name === '') {
      continue;
    }

    $result[] = [
      'id' => fb_str($outlet['id'] ?? '', 120),
      'name' => $name,
      'outletType' => $outletType,
    ];
  }

  usort($result, function ($a, $b) {
    return strcasecmp($a['name'], $b['name']);
  });

  return $result;
}

function fb_find_outlet_by_name_or_id(string $needle): ?array {
  $needle = trim($needle);
  if ($needle === '') {
    return null;
  }

  $outlets = fb_get_outlets();
  $needleLower = strtolower($needle);

  foreach ($outlets as $outlet) {
    if (strtolower($outlet['name']) === $needleLower) {
      return $outlet;
    }
    if ($outlet['id'] !== '' && strtolower($outlet['id']) === $needleLower) {
      return $outlet;
    }
  }

  return null;
}

function fb_get_feedback_settings(): array {
  $settings = fb_read_json('feedback_settings.json', []);
  if (!is_array($settings)) {
    $settings = [];
  }
  if (!isset($settings['outletConfigs']) || !is_array($settings['outletConfigs'])) {
    $settings['outletConfigs'] = [];
  }
  return $settings;
}

function fb_save_feedback_settings(array $settings): bool {
  if (!isset($settings['outletConfigs']) || !is_array($settings['outletConfigs'])) {
    $settings['outletConfigs'] = [];
  }
  $settings['updatedAt'] = fb_now_ms();
  $settings['updatedAtIso'] = fb_iso_now();
  return fb_write_json('feedback_settings.json', $settings);
}

function fb_default_outlet_config(): array {
  return [
    'googleReviewUrl' => '',
    'googlePlaceId' => '',
    'whatsappNumber' => '',
    'phoneNumber' => '',
    'reviewRedirectEnabled' => true,
  ];
}

function fb_get_outlet_config(string $outletName, array $settings): array {
  $default = fb_default_outlet_config();
  if ($outletName === '') {
    return $default;
  }

  $configs = $settings['outletConfigs'] ?? [];
  if (!is_array($configs)) {
    return $default;
  }

  foreach ($configs as $key => $config) {
    if (!is_array($config)) {
      continue;
    }
    if (strtolower(trim((string)$key)) === strtolower(trim($outletName))) {
      return array_merge($default, $config);
    }
  }

  return $default;
}

function fb_clean_phone(string $phone): string {
  $phone = trim($phone);
  if ($phone === '') {
    return '';
  }
  return preg_replace('/[^0-9+]/', '', $phone);
}

function fb_to_wa_link(string $phone, string $message = ''): string {
  $clean = preg_replace('/[^0-9]/', '', $phone);
  if ($clean === '') {
    return '';
  }
  $url = 'https://wa.me/' . $clean;
  if ($message !== '') {
    $url .= '?text=' . rawurlencode($message);
  }
  return $url;
}

function fb_feedback_file(): string {
  return 'customer_feedback.json';
}

function fb_read_feedback_entries(): array {
  return fb_read_json(fb_feedback_file(), []);
}

function fb_append_feedback_entry(array $entry): bool {
  $all = fb_read_feedback_entries();
  if (!is_array($all)) {
    $all = [];
  }
  $all[] = $entry;
  return fb_write_json(fb_feedback_file(), $all);
}

function fb_get_admin_config(): array {
  $config = fb_read_json('feedback_admin_config.json', []);
  if (!is_array($config)) {
    $config = [];
  }

  if (!isset($config['adminPasscode']) || !is_string($config['adminPasscode']) || trim($config['adminPasscode']) === '') {
    $config['adminPasscode'] = 'change-me-now';
  }
  if (!isset($config['sessionTtlHours']) || !is_numeric($config['sessionTtlHours'])) {
    $config['sessionTtlHours'] = 12;
  }
  if (!isset($config['googlePlacesApiKey']) || !is_string($config['googlePlacesApiKey'])) {
    $config['googlePlacesApiKey'] = '';
  }

  $envPass = getenv('FEEDBACK_ADMIN_PASSCODE');
  if (is_string($envPass) && trim($envPass) !== '') {
    $config['adminPasscode'] = trim($envPass);
  }
  $envGooglePlacesKey = getenv('FEEDBACK_GOOGLE_PLACES_API_KEY');
  if (is_string($envGooglePlacesKey) && trim($envGooglePlacesKey) !== '') {
    $config['googlePlacesApiKey'] = trim($envGooglePlacesKey);
  }

  return $config;
}

function fb_get_google_places_api_key_info(): array {
  $envGooglePlacesKey = getenv('FEEDBACK_GOOGLE_PLACES_API_KEY');
  if (is_string($envGooglePlacesKey) && trim($envGooglePlacesKey) !== '') {
    return [
      'key' => trim($envGooglePlacesKey),
      'source' => 'env',
    ];
  }

  $config = fb_read_json('feedback_admin_config.json', []);
  $stored = '';
  if (is_array($config)) {
    $stored = fb_str($config['googlePlacesApiKey'] ?? '', 300);
  }
  if ($stored !== '') {
    return [
      'key' => $stored,
      'source' => 'settings',
    ];
  }

  return [
    'key' => '',
    'source' => 'none',
  ];
}

function fb_save_admin_config(array $config): bool {
  return fb_write_json('feedback_admin_config.json', $config);
}

function fb_read_users(): array {
  return fb_read_json('users.json', []);
}

function fb_find_superadmin_user(string $username): ?array {
  if ($username === '') {
    return null;
  }
  $users = fb_read_users();
  $foundAnyActiveUser = false;
  foreach ($users as $user) {
    if (!is_array($user)) {
      continue;
    }
    if (isset($user['deleted']) && $user['deleted'] === true) {
      continue;
    }
    $foundAnyActiveUser = true;
    $role = fb_str($user['role'] ?? '', 30);
    $u = fb_str($user['username'] ?? '', 120);
    if ($u !== '' && strtolower($u) === strtolower($username) && $role === 'superadmin') {
      return $user;
    }
  }
  // First-time fallback: when users are not synced yet, allow "admin" as superadmin.
  if (!$foundAnyActiveUser && strtolower($username) === 'admin') {
    return [
      'id' => 'admin-bootstrap',
      'username' => 'admin',
      'role' => 'superadmin',
    ];
  }
  return null;
}

function fb_sessions_file(): string {
  return 'feedback_admin_sessions.json';
}

function fb_hash_token(string $token): string {
  return hash('sha256', $token);
}

function fb_read_sessions(): array {
  $sessions = fb_read_json(fb_sessions_file(), []);
  if (!is_array($sessions)) {
    $sessions = [];
  }
  $now = fb_now_ms();
  $active = [];
  foreach ($sessions as $s) {
    if (!is_array($s)) {
      continue;
    }
    $exp = isset($s['expiresAt']) && is_numeric($s['expiresAt']) ? (int)$s['expiresAt'] : 0;
    if ($exp > $now) {
      $active[] = $s;
    }
  }
  if (count($active) !== count($sessions)) {
    fb_write_json(fb_sessions_file(), $active);
  }
  return $active;
}

function fb_write_sessions(array $sessions): bool {
  return fb_write_json(fb_sessions_file(), $sessions);
}

function fb_issue_admin_token(string $username): array {
  $config = fb_get_admin_config();
  $ttlHours = max(1, (int)$config['sessionTtlHours']);
  $now = fb_now_ms();
  $expiresAt = $now + ($ttlHours * 60 * 60 * 1000);

  try {
    $token = bin2hex(random_bytes(24));
  } catch (Exception $e) {
    $token = hash('sha256', $username . '|' . $now . '|' . mt_rand());
  }

  $sessions = fb_read_sessions();
  $sessions[] = [
    'tokenHash' => fb_hash_token($token),
    'username' => $username,
    'role' => 'superadmin',
    'createdAt' => $now,
    'expiresAt' => $expiresAt,
  ];
  fb_write_sessions($sessions);

  return [
    'token' => $token,
    'expiresAt' => $expiresAt,
  ];
}

function fb_get_header(string $name): string {
  $key = 'HTTP_' . strtoupper(str_replace('-', '_', $name));
  if (isset($_SERVER[$key])) {
    return trim((string)$_SERVER[$key]);
  }
  if (function_exists('getallheaders')) {
    $headers = getallheaders();
    foreach ($headers as $k => $v) {
      if (strtolower($k) === strtolower($name)) {
        return trim((string)$v);
      }
    }
  }
  return '';
}

function fb_extract_admin_token(): string {
  $auth = fb_get_header('Authorization');
  if ($auth !== '' && stripos($auth, 'Bearer ') === 0) {
    return trim(substr($auth, 7));
  }
  $custom = fb_get_header('X-Admin-Token');
  if ($custom !== '') {
    return $custom;
  }
  return '';
}

function fb_require_admin_session(): array {
  $token = fb_extract_admin_token();
  if ($token === '') {
    fb_respond(['success' => false, 'error' => 'Missing admin token'], 401);
  }
  $tokenHash = fb_hash_token($token);
  $sessions = fb_read_sessions();
  foreach ($sessions as $session) {
    if (!is_array($session)) {
      continue;
    }
    if (($session['tokenHash'] ?? '') === $tokenHash) {
      return $session;
    }
  }
  fb_respond(['success' => false, 'error' => 'Invalid or expired admin token'], 401);
}

function fb_revoke_admin_token(string $token): void {
  if ($token === '') {
    return;
  }
  $tokenHash = fb_hash_token($token);
  $sessions = fb_read_sessions();
  $next = [];
  foreach ($sessions as $session) {
    if (!is_array($session)) {
      continue;
    }
    if (($session['tokenHash'] ?? '') !== $tokenHash) {
      $next[] = $session;
    }
  }
  fb_write_sessions($next);
}
