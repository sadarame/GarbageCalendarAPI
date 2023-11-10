<?php
    $transactionId = uniqid();
    //定数ファイル読み込み
    require_once 'API/AppConst.php';
    require_once 'API/DB_connect.php';

    logMessage('StartProsess');

        //HTTPS以外拒否
    if (!isset($_SERVER['HTTPS']) || $_SERVER['HTTPS'] !== 'on') {
        header("HTTP/1.1 403 Forbidden");
        exit();
    }
    
    //処理タイプ
    $type;
    $response; 

    // POSTリクエストの処理
    try {
        if ($_SERVER['REQUEST_METHOD'] === 'POST') {

            $json_data = file_get_contents('php://input');

            // JSONデータを連想配列に変換
            $data = json_decode($json_data, true);
        
            if ($data === null) {
                // JSONパースエラーが発生した場合
                http_response_code(400); // Bad Request
                echo json_encode(['error' => 'Invalid JSON data']);
                exit;
            }

            //データ取得
            $type = $data["TYPE"];
            $API_KEY = $data["API_KEY"];
            logMessage("タイプ:".$type);

            //キー情報の一致チェック
            if ($API_KEY !== API_KEY) {
                header("HTTP/1.1 403 Forbidden");
                exit();
            }

            //APIの種類の分岐
            switch($type){
                //ユーザーID生成
                case TYPE_GENERATE_USER:
                    //レスポンス作成
                    logMessage('ユーザ情報払い出し');
                    $response = generateUserIdRes();
                    break;
                //ゴミ情報登録
                case TYPE_REGIST_GARBAGE_INFO:
                    $params = $data["GARBAGE_INFO"];
                    logMessage('ゴミ情報登録開始');
                    logMessage("パラメータ: " . print_r($params, true));

                    $response = registGarbageInfo($data);
                    
                    break;
                
                //ユーザ情報登録開始
                case TYPE_REGIST_USER_INFO:
                    $params = $data["USER_INFO"];
                    logMessage('ユーザ情報登録開始');
                    logMessage("パラメータ: " . print_r($params, true));
                    $response = registUserInfo($params);
                    break;

                //エリア情報検索
                case TYPE_GET_GARBAGE_AREA:
                    $params = $data["GARBAGE_ADRRESS"];
                    logMessage('エリア情報取得開始');
                    logMessage("パラメータ: " . print_r($params, true));
                    $response = getGarbageArea($params);
                    break;

                 //ゴミ情報検索
                case TYPE_GET_GARBAGE_INFO:
                    $param = $data["GROUP_ID"];
                    logMessage('ゴミ情報取得開始');
                    logMessage("パラメータ: " . $param);
                    $response = getGarbageInfo($param);
                    break;
            }
        } else {
            $response = [
                'status' => 'error',
                'message' => 'リクエストエラーです。'
            ];
        }
    }catch(Exception $e) {
        logMessage("エラー発生".$e->getMessage());
        //レスポンス形式
        $response = [
        'status' => 'error',
        'message' => $e->getMessage()
        ];
    }
    //呼び元に返却
    header('Content-Type: application/json');
    echo json_encode($response);

    /**
     * ここから先はFucnton文
     */

    //パラメタのチェック処理
    function getParam($p){
        if (!empty($p)) {
            return $p;
        } else {
            throw new Exception('リクエスト値エラー');
        }
    }

    function getGarbageInfo($groupId){
        logMessage("開始：getGarbageInfo");
        
        $con = new DB_CONNECT();

        // $dataArray = json_decode($params, true);
        $result = $con->execSelectGarbageInfo($groupId);

        $response = [
            'status' => 'succsess',
            'result' => $result,
            'message' => ''
        ];
        
        logMessage("終了:getGarbageInfo");
        return $response ;

    }

    function getGarbageArea($params){
        logMessage("開始：getGarbageArea");
        
        $con = new DB_CONNECT();

        $dataArray = json_decode($params, true);
        $result = $con->execSelectGarbageArea($dataArray);

        $response = [
            'status' => 'succsess',
            'result' => $result,
            'message' => ''
        ];
        
        logMessage("終了:getGarbageArea");
        return $response ;

    }

    //ユーザーIDの発行処理
    function generateUserIdRes(){
        $con = new DB_CONNECT();
        $userid = "";

        //シーケンス発番のためのUpdate文
        $strql_update = 'UPDATE sequence SET id = LAST_INSERT_ID(id + 1)';
        $con->execQuery( $strql_update );

        $userid = $con->getLastInsertId();

        $response = [
            'status' => 'succsess',
            'userId' => $userid ,
            'message' => ''
        ];
        $con->closecon();
        return $response;
    }

    function registUserInfo($params){
        try {
            $dataArray = json_decode($params, true);
            logMessage("開始：registUserInfo");

            $con = new DB_CONNECT();
        
            $response = $con->execSelectInsertUserInfo($dataArray);

            $con->closecon();

            logMessage("正常終了：registGarbageInfo");
            return $response;

        } catch (PDOException $e) {
            // エラーハンドリング
            $response = [
                'status' => 'error',
                'message' => "データベースエラー: " . $e->getMessage()
            ];
            return $response;
        }
    }

    function registGarbageGroup(){

    }

    function registGarbageInfo($data){
        logMessage("開始：registGarbageInfo");


        $params = $data["GARBAGE_INFO"];
        $userId = $data["USER_ID"];
        $garbageInfoName = $data["GARBAGE_INFO_NAME"];
        $convNo = $data["CONV_NO"];

        $logMessage = "Params: " . print_r($params, true) . ", UserId: $userId, GarbageInfoName: $garbageInfoName, ConvNo: $convNo";
        logMessage($logMessage);

        //変換
        $dataArray = json_decode($params, true);
        //ゴミID格納用配列
        $garbageArray = array();
        //DBコネクト
        $con = new DB_CONNECT();

        //ゴミ情報のセレクトインサート
        foreach ($dataArray as $param) {
            switch ($param["schedule"]) {      
                case "毎週":
                    array_push($garbageArray,$con->execEveryWeeksQuery($param));
                    // $con->execEveryWeeksQuery($param);
                    break;
                case "隔週":
                    array_push($garbageArray,$con->execEveryOtherWeekQuery($param));
                    // $con->execEveryOtherWeekQuery($param);
                    break;
                case "毎月":
                    array_push($garbageArray,$con->execEveryMonthQuery($param));
                    // $con->execEveryMonthQuery($param);
                    break;
                case "第○曜日":
                    // $variableが$value3と等しい場合の処理
                    array_push($garbageArray,$con->execNumberOfYobiQuery($param));
                    // $con->execNumberOfYobiQuery($param);
                    break;    
                default:
                    // 上記のいずれの条件にも該当しない場合の処理
                    break;
            }
        }
        //ごみIDを出力
        logMessage("配列: " . print_r($garbageArray, true));

        //ゴミIDを元にグループ検索
        $groupId = $con->execGarbageGroupQuery($garbageArray);
        
        //紐づけマスタ、ゴミグループテーブルに突っ込む
        $con->execGarbageConvArea($groupId,$userId,$garbageInfoName,$convNo);

        $response = [
            'status' => 'succsess',
            'message' => ''
        ];
        
        logMessage("正常終了：registGarbageInfo");
        $con->closecon();
        return $response;
    }

    function logMessage($message) {
        global $transactionId;
        $logFile = 'API/logs/api_log.txt';
        $timestamp = date('Y-m-d H:i:s');
        $logEntry = "$timestamp - [$transactionId] - $message" . PHP_EOL;
        file_put_contents($logFile, $logEntry, FILE_APPEND);
    }

