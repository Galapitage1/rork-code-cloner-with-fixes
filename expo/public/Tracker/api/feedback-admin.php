<?php
require_once __DIR__ . '/feedback-common.php';

fb_preflight('GET, POST, OPTIONS');

function fb_parse_date_start(string $date): ?int {
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    return null;
  }
  $ts = strtotime($date . ' 00:00:00 UTC');
  return $ts === false ? null : ((int)$ts * 1000);
}

function fb_parse_date_end(string $date): ?int {
  if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
    return null;
  }
  $ts = strtotime($date . ' 23:59:59 UTC');
  return $ts === false ? null : ((int)$ts * 1000);
}

function fb_filter_entries(array $entries, string $outlet, ?int $startMs, ?int $endMs): array {
  $filtered = [];
  $outletLower = strtolower(trim($outlet));

  foreach ($entries as $entry) {
    if (!is_array($entry)) {
      continue;
    }
    $ts = isset($entry['createdAt']) && is_numeric($entry['createdAt']) ? (int)$entry['createdAt'] : 0;
    if ($startMs !== null && $ts < $startMs) {
      continue;
    }
    if ($endMs !== null && $ts > $endMs) {
      continue;
    }
    if ($outletLower !== '') {
      $name = strtolower(trim((string)($entry['outlet'] ?? '')));
      if ($name !== $outletLower) {
        continue;
      }
    }
    $filtered[] = $entry;
  }

  usort($filtered, function ($a, $b) {
    return (int)($b['createdAt'] ?? 0) <=> (int)($a['createdAt'] ?? 0);
  });

  return $filtered;
}

function fb_compute_analytics(array $entries): array {
  $total = count($entries);
  $sumOverall = 0;
  $positive = 0;
  $detractors = 0;
  $aspects = ['service' => 0, 'quality' => 0, 'cleanliness' => 0, 'speed' => 0, 'value' => 0];
  $aspectCounts = ['service' => 0, 'quality' => 0, 'cleanliness' => 0, 'speed' => 0, 'value' => 0];
  $ratingDistribution = ['1' => 0, '2' => 0, '3' => 0, '4' => 0, '5' => 0];
  $byOutlet = [];
  $byDate = [];

  foreach ($entries as $entry) {
    $rating = isset($entry['overallRating']) && is_numeric($entry['overallRating']) ? (int)$entry['overallRating'] : 0;
    if ($rating > 0) {
      $sumOverall += $rating;
      $key = (string)$rating;
      if (isset($ratingDistribution[$key])) {
        $ratingDistribution[$key]++;
      }
      if ($rating >= 4) {
        $positive++;
      } else {
        $detractors++;
      }
    }

    $outlet = fb_str($entry['outlet'] ?? 'Unknown Outlet', 120);
    if (!isset($byOutlet[$outlet])) {
      $byOutlet[$outlet] = [
        'outlet' => $outlet,
        'total' => 0,
        'sumOverall' => 0,
        'positive' => 0,
      ];
    }
    $byOutlet[$outlet]['total']++;
    $byOutlet[$outlet]['sumOverall'] += $rating;
    if ($rating >= 4) {
      $byOutlet[$outlet]['positive']++;
    }

    $entryDate = fb_str($entry['date'] ?? '', 20);
    if ($entryDate === '') {
      $ts = isset($entry['createdAt']) && is_numeric($entry['createdAt']) ? (int)$entry['createdAt'] : 0;
      if ($ts > 0) {
        $entryDate = gmdate('Y-m-d', (int)floor($ts / 1000));
      }
    }
    if ($entryDate !== '') {
      if (!isset($byDate[$entryDate])) {
        $byDate[$entryDate] = ['date' => $entryDate, 'count' => 0, 'sumOverall' => 0];
      }
      $byDate[$entryDate]['count']++;
      $byDate[$entryDate]['sumOverall'] += $rating;
    }

    $entryAspects = is_array($entry['aspects'] ?? null) ? $entry['aspects'] : [];
    foreach ($aspects as $k => $_) {
      if (isset($entryAspects[$k]) && is_numeric($entryAspects[$k])) {
        $v = (int)$entryAspects[$k];
        if ($v >= 1 && $v <= 5) {
          $aspects[$k] += $v;
          $aspectCounts[$k]++;
        }
      }
    }
  }

  $outletBreakdown = array_values(array_map(function ($row) {
    $avg = $row['total'] > 0 ? round($row['sumOverall'] / $row['total'], 2) : 0;
    $posRate = $row['total'] > 0 ? round(($row['positive'] / $row['total']) * 100, 1) : 0;
    return [
      'outlet' => $row['outlet'],
      'total' => $row['total'],
      'avgOverall' => $avg,
      'positiveRate' => $posRate,
    ];
  }, $byOutlet));

  usort($outletBreakdown, function ($a, $b) {
    return $b['total'] <=> $a['total'];
  });

  $aspectAverages = [];
  foreach ($aspects as $k => $sum) {
    $aspectAverages[$k] = $aspectCounts[$k] > 0 ? round($sum / $aspectCounts[$k], 2) : 0;
  }

  ksort($byDate);
  $dailyTrend = array_values(array_map(function ($row) {
    $count = (int)($row['count'] ?? 0);
    $avg = $count > 0 ? round(((float)($row['sumOverall'] ?? 0)) / $count, 2) : 0;
    return [
      'date' => fb_str($row['date'] ?? '', 20),
      'count' => $count,
      'avgOverall' => $avg,
    ];
  }, $byDate));
  if (count($dailyTrend) > 60) {
    $dailyTrend = array_slice($dailyTrend, -60);
  }

  return [
    'summary' => [
      'totalResponses' => $total,
      'avgOverall' => $total > 0 ? round($sumOverall / $total, 2) : 0,
      'positiveCount' => $positive,
      'detractorCount' => $detractors,
      'positiveRate' => $total > 0 ? round(($positive / $total) * 100, 1) : 0,
      'aspectAverages' => $aspectAverages,
      'ratingDistribution' => $ratingDistribution,
      'dailyTrend' => $dailyTrend,
    ],
    'outletBreakdown' => $outletBreakdown,
  ];
}

function fb_google_reviews_cache_file(): string {
  return 'feedback_google_reviews_cache.json';
}

function fb_read_google_reviews_cache(): array {
  $cache = fb_read_json(fb_google_reviews_cache_file(), []);
  return is_array($cache) ? $cache : [];
}

function fb_save_google_reviews_cache(array $cache): void {
  fb_write_json(fb_google_reviews_cache_file(), $cache);
}

function fb_http_get_json(string $url, int $timeoutSec = 15): array {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    if ($ch === false) {
      return ['ok' => false, 'json' => null, 'error' => 'Failed to initialize HTTP client'];
    }
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $timeoutSec);
    curl_setopt($ch, CURLOPT_TIMEOUT, $timeoutSec);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    $raw = curl_exec($ch);
    $httpCode = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);
    curl_close($ch);
    if ($raw === false) {
      return ['ok' => false, 'json' => null, 'error' => ($error !== '' ? $error : 'Request failed')];
    }
    if ($httpCode >= 400) {
      return ['ok' => false, 'json' => null, 'error' => 'HTTP ' . $httpCode];
    }
    $decoded = json_decode((string)$raw, true);
    if (!is_array($decoded)) {
      return ['ok' => false, 'json' => null, 'error' => 'Invalid JSON response'];
    }
    return ['ok' => true, 'json' => $decoded, 'error' => ''];
  }

  $ctx = stream_context_create([
    'http' => [
      'method' => 'GET',
      'timeout' => $timeoutSec,
      'ignore_errors' => true,
    ],
  ]);
  $raw = @file_get_contents($url, false, $ctx);
  if ($raw === false) {
    return ['ok' => false, 'json' => null, 'error' => 'HTTP request failed'];
  }
  $decoded = json_decode((string)$raw, true);
  if (!is_array($decoded)) {
    return ['ok' => false, 'json' => null, 'error' => 'Invalid JSON response'];
  }
  return ['ok' => true, 'json' => $decoded, 'error' => ''];
}

function fb_fetch_place_reviews(string $placeId, string $apiKey): array {
  if ($placeId === '') {
    return ['success' => false, 'error' => 'Missing place ID'];
  }
  if ($apiKey === '') {
    return ['success' => false, 'error' => 'Google Places API key is not configured'];
  }

  $url = 'https://maps.googleapis.com/maps/api/place/details/json'
    . '?place_id=' . rawurlencode($placeId)
    . '&fields=' . rawurlencode('name,rating,user_ratings_total,reviews,url')
    . '&reviews_sort=newest'
    . '&key=' . rawurlencode($apiKey);

  $http = fb_http_get_json($url, 15);
  if (!$http['ok']) {
    return ['success' => false, 'error' => fb_str($http['error'] ?? 'Failed to fetch Google reviews', 300)];
  }

  $payload = is_array($http['json'] ?? null) ? $http['json'] : [];
  $status = fb_str($payload['status'] ?? '', 40);
  if ($status !== 'OK') {
    $errText = fb_str($payload['error_message'] ?? $status, 300);
    return ['success' => false, 'error' => ($errText !== '' ? $errText : 'Google Places returned an error')];
  }

  $result = is_array($payload['result'] ?? null) ? $payload['result'] : [];
  $reviewsRaw = is_array($result['reviews'] ?? null) ? $result['reviews'] : [];
  $reviews = [];
  foreach ($reviewsRaw as $r) {
    if (!is_array($r)) {
      continue;
    }
    $reviews[] = [
      'authorName' => fb_str($r['author_name'] ?? 'Anonymous', 120),
      'rating' => isset($r['rating']) && is_numeric($r['rating']) ? (int)$r['rating'] : 0,
      'text' => fb_str($r['text'] ?? '', 2000),
      'relativeTime' => fb_str($r['relative_time_description'] ?? '', 120),
      'time' => isset($r['time']) && is_numeric($r['time']) ? (int)$r['time'] : 0,
    ];
  }

  return [
    'success' => true,
    'placeName' => fb_str($result['name'] ?? '', 200),
    'rating' => isset($result['rating']) && is_numeric($result['rating']) ? round((float)$result['rating'], 2) : 0,
    'userRatingsTotal' => isset($result['user_ratings_total']) && is_numeric($result['user_ratings_total']) ? (int)$result['user_ratings_total'] : 0,
    'googleMapsUrl' => fb_str($result['url'] ?? '', 800),
    'reviews' => $reviews,
  ];
}

$action = fb_str($_GET['action'] ?? '', 60);
$body = $_SERVER['REQUEST_METHOD'] === 'POST' ? fb_get_request_json() : [];

if ($action === 'login') {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fb_respond(['success' => false, 'error' => 'Method not allowed'], 405);
  }

  $username = fb_str($body['username'] ?? '', 120);
  $passcode = fb_str($body['passcode'] ?? '', 120);
  if ($username === '' || $passcode === '') {
    fb_respond(['success' => false, 'error' => 'Username and passcode are required'], 400);
  }

  $user = fb_find_superadmin_user($username);
  if ($user === null) {
    fb_respond(['success' => false, 'error' => 'Only superadmin users can access this dashboard'], 403);
  }

  $config = fb_get_admin_config();
  $expectedPasscode = fb_str($config['adminPasscode'] ?? '', 120);
  if ($expectedPasscode === '' || $passcode !== $expectedPasscode) {
    fb_respond(['success' => false, 'error' => 'Invalid passcode'], 401);
  }

  $tokenInfo = fb_issue_admin_token($username);
  $mustChangePasscode = $expectedPasscode === 'change-me-now';

  fb_respond([
    'success' => true,
    'token' => $tokenInfo['token'],
    'expiresAt' => $tokenInfo['expiresAt'],
    'username' => $username,
    'mustChangePasscode' => $mustChangePasscode,
  ]);
}

if ($action === 'public-outlets') {
  fb_respond([
    'success' => true,
    'outlets' => fb_get_outlets(),
  ]);
}

$session = fb_require_admin_session();

if ($action === 'logout') {
  $token = fb_extract_admin_token();
  fb_revoke_admin_token($token);
  fb_respond(['success' => true]);
}

if ($action === 'change-passcode') {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fb_respond(['success' => false, 'error' => 'Method not allowed'], 405);
  }
  $newPasscode = fb_str($body['newPasscode'] ?? '', 120);
  if (strlen($newPasscode) < 6) {
    fb_respond(['success' => false, 'error' => 'Passcode must be at least 6 characters'], 400);
  }
  $config = fb_get_admin_config();
  $config['adminPasscode'] = $newPasscode;
  if (!fb_save_admin_config($config)) {
    fb_respond(['success' => false, 'error' => 'Failed to save passcode'], 500);
  }
  fb_respond(['success' => true]);
}

if ($action === 'save-settings') {
  if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    fb_respond(['success' => false, 'error' => 'Method not allowed'], 405);
  }
  $incoming = is_array($body['outletConfigs'] ?? null) ? $body['outletConfigs'] : [];
  $googlePlacesApiKey = fb_str($body['googlePlacesApiKey'] ?? '', 300);
  $clearGooglePlacesApiKey = fb_bool($body['clearGooglePlacesApiKey'] ?? false);
  $clean = [];
  foreach ($incoming as $outletName => $config) {
    $name = fb_str($outletName, 120);
    if ($name === '' || !is_array($config)) {
      continue;
    }
    $clean[$name] = [
      'googleReviewUrl' => fb_str($config['googleReviewUrl'] ?? '', 600),
      'googlePlaceId' => fb_normalize_google_place_id(fb_str($config['googlePlaceId'] ?? '', 600)),
      'whatsappNumber' => fb_clean_phone(fb_str($config['whatsappNumber'] ?? '', 40)),
      'phoneNumber' => fb_clean_phone(fb_str($config['phoneNumber'] ?? '', 40)),
      'reviewRedirectEnabled' => fb_bool($config['reviewRedirectEnabled'] ?? true),
    ];
  }
  $settings = fb_get_feedback_settings();
  $settings['outletConfigs'] = $clean;
  $settings['updatedBy'] = fb_str($session['username'] ?? 'unknown', 120);
  if (!fb_save_feedback_settings($settings)) {
    fb_respond(['success' => false, 'error' => 'Failed to save settings'], 500);
  }

  $adminConfig = fb_get_admin_config();
  if ($googlePlacesApiKey !== '') {
    $adminConfig['googlePlacesApiKey'] = $googlePlacesApiKey;
  } elseif ($clearGooglePlacesApiKey) {
    $adminConfig['googlePlacesApiKey'] = '';
  }
  $adminConfig['updatedBy'] = fb_str($session['username'] ?? 'unknown', 120);
  fb_save_admin_config($adminConfig);
  $keyInfo = fb_get_google_places_api_key_info();

  fb_respond([
    'success' => true,
    'settings' => $settings,
    'googlePlacesApiKeyConfigured' => fb_str($keyInfo['key'] ?? '', 300) !== '',
    'googlePlacesApiKeySource' => fb_str($keyInfo['source'] ?? 'none', 20),
  ]);
}

if ($action === 'google-reviews') {
  $requestedOutlet = fb_str($_GET['outlet'] ?? '', 120);
  $forceRefresh = fb_bool($_GET['force'] ?? false);
  $cacheTtlMs = 30 * 60 * 1000;
  $now = fb_now_ms();

  $settings = fb_get_feedback_settings();
  $keyInfo = fb_get_google_places_api_key_info();
  $apiKey = fb_str($keyInfo['key'] ?? '', 300);
  $apiKeySource = fb_str($keyInfo['source'] ?? 'none', 20);

  $outlets = fb_get_outlets();
  if ($requestedOutlet !== '') {
    $requestedLower = strtolower($requestedOutlet);
    $outlets = array_values(array_filter($outlets, function ($o) use ($requestedLower) {
      return strtolower(fb_str($o['name'] ?? '', 120)) === $requestedLower;
    }));
  }

  if ($apiKey === '') {
    fb_respond([
      'success' => true,
      'apiKeyConfigured' => false,
      'apiKeySource' => $apiKeySource,
      'message' => 'Google Places API key is not configured.',
      'reviews' => [],
    ]);
  }

  $cache = fb_read_google_reviews_cache();
  $rows = [];
  $configuredOutlets = 0;

  foreach ($outlets as $outlet) {
    $outletName = fb_str($outlet['name'] ?? '', 120);
    if ($outletName === '') {
      continue;
    }
    $config = fb_get_outlet_config($outletName, $settings);
    $placeId = fb_normalize_google_place_id(fb_str($config['googlePlaceId'] ?? '', 600));
    if ($placeId === '') {
      continue;
    }
    $configuredOutlets++;

    $cacheKey = strtolower($placeId);
    $cached = is_array($cache[$cacheKey] ?? null) ? $cache[$cacheKey] : null;
    $cachedAt = isset($cached['fetchedAt']) && is_numeric($cached['fetchedAt']) ? (int)$cached['fetchedAt'] : 0;
    $cachedData = is_array($cached['data'] ?? null) ? $cached['data'] : null;
    $useCache = (!$forceRefresh && $cachedData !== null && ($now - $cachedAt) <= $cacheTtlMs);

    $data = null;
    $source = 'live';
    if ($useCache) {
      $data = $cachedData;
      $source = 'cache';
    } else {
      $fetched = fb_fetch_place_reviews($placeId, $apiKey);
      if (!($fetched['success'] ?? false) && $cachedData !== null) {
        $data = $cachedData;
        $source = 'stale-cache';
      } else {
        $data = $fetched;
        $cache[$cacheKey] = [
          'fetchedAt' => $now,
          'data' => $fetched,
        ];
      }
    }

    $rows[] = [
      'outlet' => $outletName,
      'googlePlaceId' => $placeId,
      'placeName' => fb_str($data['placeName'] ?? '', 200),
      'rating' => isset($data['rating']) && is_numeric($data['rating']) ? (float)$data['rating'] : 0,
      'userRatingsTotal' => isset($data['userRatingsTotal']) && is_numeric($data['userRatingsTotal']) ? (int)$data['userRatingsTotal'] : 0,
      'googleMapsUrl' => fb_str($data['googleMapsUrl'] ?? '', 800),
      'reviews' => is_array($data['reviews'] ?? null) ? $data['reviews'] : [],
      'error' => fb_str($data['error'] ?? '', 300),
      'source' => $source,
      'fetchedAt' => $now,
    ];
  }

  fb_save_google_reviews_cache($cache);

  fb_respond([
    'success' => true,
    'apiKeyConfigured' => true,
    'apiKeySource' => $apiKeySource,
    'configuredOutlets' => $configuredOutlets,
    'reviews' => $rows,
  ]);
}

if ($action === 'analytics' || $action === 'bootstrap') {
  $startDate = fb_str($_GET['startDate'] ?? '', 20);
  $endDate = fb_str($_GET['endDate'] ?? '', 20);
  $outlet = fb_str($_GET['outlet'] ?? '', 120);
  $page = isset($_GET['page']) && is_numeric($_GET['page']) ? max(1, (int)$_GET['page']) : 1;
  $limit = isset($_GET['limit']) && is_numeric($_GET['limit']) ? max(10, min(200, (int)$_GET['limit'])) : 50;

  if ($action === 'bootstrap' && $startDate === '' && $endDate === '') {
    $endDate = gmdate('Y-m-d');
    $startDate = gmdate('Y-m-d', strtotime('-30 days'));
  }

  $startMs = $startDate !== '' ? fb_parse_date_start($startDate) : null;
  $endMs = $endDate !== '' ? fb_parse_date_end($endDate) : null;

  $allEntries = fb_read_feedback_entries();
  $filtered = fb_filter_entries($allEntries, $outlet, $startMs, $endMs);
  $analytics = fb_compute_analytics($filtered);

  $total = count($filtered);
  $offset = ($page - 1) * $limit;
  $recent = array_slice($filtered, $offset, $limit);

  $settings = fb_get_feedback_settings();
  $keyInfo = fb_get_google_places_api_key_info();
  fb_respond([
    'success' => true,
    'filters' => [
      'startDate' => $startDate,
      'endDate' => $endDate,
      'outlet' => $outlet,
      'page' => $page,
      'limit' => $limit,
    ],
    'summary' => $analytics['summary'],
    'outletBreakdown' => $analytics['outletBreakdown'],
    'recent' => $recent,
    'pagination' => [
      'total' => $total,
      'page' => $page,
      'limit' => $limit,
      'hasMore' => ($offset + $limit) < $total,
    ],
    'settings' => $settings,
    'googlePlacesApiKeyConfigured' => fb_str($keyInfo['key'] ?? '', 300) !== '',
    'googlePlacesApiKeySource' => fb_str($keyInfo['source'] ?? 'none', 20),
    'outlets' => fb_get_outlets(),
    'session' => [
      'username' => fb_str($session['username'] ?? '', 120),
      'role' => fb_str($session['role'] ?? '', 40),
    ],
  ]);
}

fb_respond(['success' => false, 'error' => 'Unsupported action'], 400);
