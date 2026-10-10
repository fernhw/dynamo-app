<?php
namespace OCA\Screenplay\Listener;

use OCA\Files\Event\LoadAdditionalScriptsEvent;
use OCP\EventDispatcher\Event;
use OCP\EventDispatcher\IEventListener;

/** @template-implements IEventListener<LoadAdditionalScriptsEvent> */
class LoadScriptsListener implements IEventListener {
    public function handle(Event $event): void {
        if (!$event instanceof LoadAdditionalScriptsEvent) {
            return;
        }
        \OCP\Util::addScript('screenplay', 'files-action');
    }
}
