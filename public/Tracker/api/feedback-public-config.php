<?php
require_once __DIR__ . '/feedback-common.php';

fb_preflight('GET, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
  fb_respond(['success' => false, 'error' => 'Method not allowed'], 405);
}

$requestedOutlet = fb_str($_GET['outlet'] ?? '', 120);
$settings = fb_get_feedback_settings();
$outlets = fb_get_outlets();

$resolvedOutlet = null;
if ($requestedOutlet !== '') {
  $resolvedOutlet = fb_find_outlet_by_name_or_id($requestedOutlet);
}

$resolvedName = $resolvedOutlet['name'] ?? $requestedOutlet;
$config = fb_get_outlet_config($resolvedName, $settings);

fb_respond([
  'success' => true,
  'requestedOutlet' => $requestedOutlet,
  'resolvedOutlet' => $resolvedOutlet,
  'config' => [
    'googleReviewUrl' => fb_str($config['googleReviewUrl'] ?? '', 600),
    'whatsappNumber' => fb_clean_phone((string)($config['whatsappNumber'] ?? '')),
    'phoneNumber' => fb_clean_phone((string)($config['phoneNumber'] ?? '')),
    'reviewRedirectEnabled' => fb_bool($config['reviewRedirectEnabled'] ?? true),
  ],
  'outlets' => $outlets,
]);
