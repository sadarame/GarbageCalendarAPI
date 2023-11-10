<?php
class Logger {
    private $logFile;

    public function __construct($logFile) {
        $this->logFile = $logFile;
    }

    public function log($message) {
        $transactionId = uniqid();
        $logMessage = "[" . date('Y-m-d H:i:s') . "] [Transaction ID: " . $transactionId . "] " . $message . PHP_EOL;
        file_put_contents($this->logFile, $logMessage, FILE_APPEND);
    }
}