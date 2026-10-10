<?php
style('screenplay', 'screenplay-main');
$nonce = \OC::$server->getContentSecurityPolicyNonceManager()->getNonce();
$user  = \OC::$server->getUserSession()->getUser()->getUID();
$jsPath = __DIR__ . '/../js/screenplay-main.js';
$build  = @filemtime($jsPath) ?: time();
$lexPath = __DIR__ . '/../js/lexicon-en-20k.txt';
$lex = file_exists($lexPath)
  ? file($lexPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES)
  : [];
?>
<script nonce="<?php p($nonce); ?>">
window._SP_USER = '<?php p($user); ?>';
window._SP_BUILD = '<?php p((string)$build); ?>';
window._SP_LEXICON_EN = <?php echo json_encode(array_values($lex), JSON_UNESCAPED_SLASHES); ?>;
<?php echo file_get_contents(__DIR__ . '/../js/screenplay-main.js'); ?>
</script>
<div id="screenplay-root" style="width:100%;height:100%;position:fixed;top:50px;left:0;right:0;bottom:0;background:#1e1e2e;">
  <div id="app-content-vue"></div>
</div>
