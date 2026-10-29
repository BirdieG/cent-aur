<?php
// OPTIONAL. Only if you need it: rename this file to config.php and edit.
return array(
    // If the Cloudflare orange cloud is ON, uncomment so the login limiter sees real visitor addresses:
    // 'ip_header' => 'HTTP_CF_CONNECTING_IP',
    // The header above is only believed from Cloudflare's own addresses (built in). For a different
    // proxy, list the addresses it connects from:
    // 'trusted_proxies' => array('10.0.0.5/32'),
    // Folder for the database (must be OUTSIDE public_html). Empty = automatic:
    // 'data_dir' => '/home/youruser/cent-aur-data',
    // How long a sign-in lasts without being used, in days:
    // 'session_days' => 90,
);
