<?php
    //
    function decodeRequestData() {
        // メソッドの処理
        //HTTPS以外拒否
        if (!isset($_SERVER['HTTPS']) || $_SERVER['HTTPS'] !== 'on') {
            header("HTTP/1.1 403 Forbidden");
            exit();
        }

        if (!$_SERVER['REQUEST_METHOD'] === 'POST') {
            header("HTTP/1.1 403 Forbidden");
            exit();
        }
        
        $json_data = file_get_contents('php://input');
        // JSONデータを連想配列に変換
        $data = json_decode($json_data, true);

        // JSONパースエラーが発生した場合
        if ($data === null) {
            // JSONパースエラーが発生した場合
            http_response_code(400); // Bad Request
            echo json_encode(['error' => 'Invalid JSON data']);
            exit;
        }

        if ($data["API_KEY"] !== API_KEY) {
            header("HTTP/1.1 403 Forbidden");
            exit();
        }

        return $data;

    }