<?php
require_once __DIR__ . '/feedback-common.php';

fb_preflight('POST, OPTIONS');

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
  fb_respond(['success' => false, 'error' => 'Method not allowed'], 405);
}

$body = fb_get_request_json();

$outletInput = fb_str($body['outlet'] ?? '', 120);
$outletIdInput = fb_str($body['outletId'] ?? '', 120);
$overallRating = fb_int($body['overallRating'] ?? null, 1, 5);

if ($outletInput === '' && $outletIdInput === '') {
  fb_respond(['success' => false, 'error' => 'Outlet is required'], 400);
}
if ($overallRating === null) {
  fb_respond(['success' => false, 'error' => 'Overall rating is required (1-5)'], 400);
}

$resolvedOutlet = null;
if ($outletIdInput !== '') {
  $resolvedOutlet = fb_find_outlet_by_name_or_id($outletIdInput);
}
if ($resolvedOutlet === null && $outletInput !== '') {
  $resolvedOutlet = fb_find_outlet_by_name_or_id($outletInput);
}

$finalOutletName = $resolvedOutlet['name'] ?? ($outletInput !== '' ? $outletInput : $outletIdInput);
$finalOutletId = $resolvedOutlet['id'] ?? $outletIdInput;

$aspectsInput = is_array($body['aspects'] ?? null) ? $body['aspects'] : [];
$aspectKeys = ['service', 'quality', 'cleanliness', 'speed', 'value'];
$aspects = [];
foreach ($aspectKeys as $key) {
  $aspects[$key] = fb_int($aspectsInput[$key] ?? null, 1, 5);
}

$comment = fb_str($body['comment'] ?? '', 2000);
$contactName = fb_str($body['contactName'] ?? '', 120);
$contactPhone = fb_clean_phone(fb_str($body['contactPhone'] ?? '', 40));
$wantContact = fb_bool($body['wantContact'] ?? false);

$nowMs = fb_now_ms();
$entryId = 'fb-' . $nowMs . '-' . substr(hash('sha1', (string)mt_rand()), 0, 8);

$entry = [
  'id' => $entryId,
  'outlet' => $finalOutletName,
  'outletId' => $finalOutletId,
  'overallRating' => $overallRating,
  'aspects' => $aspects,
  'comment' => $comment,
  'contactName' => $contactName,
  'contactPhone' => $contactPhone,
  'wantContact' => $wantContact,
  'createdAt' => $nowMs,
  'createdAtIso' => fb_iso_now(),
  'date' => gmdate('Y-m-d'),
  'positiveFlow' => $overallRating >= 4,
  'userAgent' => fb_str($_SERVER['HTTP_USER_AGENT'] ?? '', 400),
  'sourceUrl' => fb_str($body['sourceUrl'] ?? '', 800),
];

if (!fb_append_feedback_entry($entry)) {
  fb_respond(['success' => false, 'error' => 'Failed to save feedback'], 500);
}

$settings = fb_get_feedback_settings();
$outletConfig = fb_get_outlet_config($finalOutletName, $settings);
$googleReviewUrl = fb_str($outletConfig['googleReviewUrl'] ?? '', 600);
$whatsappNumber = fb_clean_phone((string)($outletConfig['whatsappNumber'] ?? ''));
$phoneNumber = fb_clean_phone((string)($outletConfig['phoneNumber'] ?? ''));

$complaintMessage = 'Hello, I would like to report an issue with my recent visit to ' . $finalOutletName . '.';
$whatsappUrl = fb_to_wa_link($whatsappNumber, $complaintMessage);
$callUrl = $phoneNumber !== '' ? ('tel:' . $phoneNumber) : '';

$nextStep = [
  'type' => 'thank_you',
  'googleReviewUrl' => '',
  'whatsappUrl' => '',
  'callUrl' => '',
];

if ($overallRating >= 4) {
  if ($googleReviewUrl !== '') {
    $nextStep['type'] = 'google_review';
    $nextStep['googleReviewUrl'] = $googleReviewUrl;
  }
} else {
  if ($whatsappUrl !== '' || $callUrl !== '') {
    $nextStep['type'] = 'complaint';
    $nextStep['whatsappUrl'] = $whatsappUrl;
    $nextStep['callUrl'] = $callUrl;
  }
}

fb_respond([
  'success' => true,
  'id' => $entryId,
  'outlet' => $finalOutletName,
  'overallRating' => $overallRating,
  'nextStep' => $nextStep,
]);
