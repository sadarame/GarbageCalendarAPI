<?php
    require_once 'AppConst.php';

    class DB_CONNECT {

        private $pdo;

        //コンストラクタ
        public function __construct() {
            //DBコネクション作成
            $this->pdo = new PDO(DSN, DB_USER, DB_PASSWORD);
            $this->pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
        }
    
        //引数で受け取ったクエリを実行する
        public function execQuery($strQuery) {
            $stmt = $this->pdo->prepare($strQuery);
            $stmt->execute();
            $results = $stmt->fetchAll(PDO::FETCH_ASSOC);
            return $results;
        }

        //ゴミ情報の取得
        public function execSelectGarbageInfo($garbageGroupId) {
            $sql = "SELECT id, garbageType, schedule, yobi, day, month, date, weekOfMonth, freqWeek 
                    FROM TB_GARBAGE_INFO 
                    WHERE id IN (
                        SELECT garbageId 
                        FROM TB_GARBAGE_GROUP 
                        WHERE garbageGroupId = :garbageGroupId
                    )";
            
            try {
                $stmt = $this->pdo->prepare($sql);
                $stmt->bindParam(':garbageGroupId', $garbageGroupId, PDO::PARAM_INT);
                $stmt->execute();
                
                $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
                return $result;
            } catch(PDOException $e) {
                // エラーハンドリングの処理を記述する（例外をキャッチして適切な対応を行う）
                throw $e;
            }
        }
        

        //エリア検索
        public function execSelectGarbageArea($data) {
            logMessage("開始：execSelectGarbageArea");
            // logMessage("パラメータ: " . print_r($data, true));
        
            $targetLatitude = $data['latitude'];  // 特定の地点の緯度
            $targetLongitude = $data['longitude'];  // 特定の地点の経度
        
            logMessage($targetLatitude + $targetLongitude);
        
            $sql = "SELECT *
            FROM TB_GARBAGE_AREA_CONV
            WHERE (6371 * ACOS(
                    COS(RADIANS(:targetLatitude)) * COS(RADIANS(latitude)) *
                    COS(RADIANS(:targetLongitude) - RADIANS(longitude)) +
                    SIN(RADIANS(:targetLatitude)) * SIN(RADIANS(latitude))
                )) <= 2
            ORDER BY usageCount DESC";
    
        
            try {
                $stmt = $this->pdo->prepare($sql);
                $stmt->bindParam(':targetLatitude', $targetLatitude, PDO::PARAM_STR);
                $stmt->bindParam(':targetLongitude', $targetLongitude, PDO::PARAM_STR);
                $stmt->execute();
        
                $result = $stmt->fetchAll(PDO::FETCH_ASSOC);
        
                $logMessage = "Query Result: " . json_encode($result, JSON_UNESCAPED_UNICODE);
                logMessage("実行結果" . $logMessage);
                logMessage("終了：execSelectGarbageArea");
        
                return $result;
            } catch(PDOException $e) {
                // エラーハンドリングの処理を記述する（例外をキャッチして適切な対応を行う）
                throw $e;
            }
        }
        

        //ユーザー情報登録
        public function execSelectInsertUserInfo($data) {
            logMessage("開始：execSelectInsertUserInfo");
        
            try {
                // データベースに接続
                // userIdでレコードを検索するSELECT文の準備
                $selectStmt = $this->pdo->prepare("SELECT * FROM TB_USER_INFO WHERE user_id = :user_id");
                $selectStmt->bindParam(':user_id', $data['userId']);
                $selectStmt->execute();
        
                $rowCount = $selectStmt->rowCount();
        
                logMessage("SELECT実行結果" . $rowCount);
        
                if ($rowCount > 0) {
                    logMessage("UPDATE開始");
                    // レコードが存在する場合はUPDATE文を実行
                    $updateStmt = $this->pdo->prepare("UPDATE TB_USER_INFO SET sub_locality = :sub_locality, locality = :locality, postal_code = :postal_code, administrative_area = :administrative_area, sub_thoroughfare = :sub_thoroughfare, build_name = :build_name, sub_administrative_area = :sub_administrative_area, thoroughfare = :thoroughfare, latitude = :latitude, longitude = :longitude, fcm_token = :fcm_token, last_updated = :last_updated WHERE user_id = :user_id");
                    $updateStmt->bindParam(':sub_locality', $data['subLocality']);
                    $updateStmt->bindParam(':locality', $data['locality']);
                    $updateStmt->bindParam(':postal_code', str_replace("-", "", $data['postalCode']));
                    $updateStmt->bindParam(':administrative_area', $data['administrativeArea']);
                    $updateStmt->bindParam(':sub_thoroughfare', $data['subThoroughfare']);
                    $updateStmt->bindParam(':build_name', $data['buildName']);
                    $updateStmt->bindParam(':sub_administrative_area', $data['subAdministrativeArea']);
                    $updateStmt->bindParam(':thoroughfare', $data['thoroughfare']);
                    $updateStmt->bindParam(':latitude', $data['latitude']);
                    $updateStmt->bindParam(':longitude', $data['longitude']);
                    $updateStmt->bindParam(':fcm_token', $data['fcm_token']); // 新しい項目のバインド
                    $updateStmt->bindParam(':last_updated', $data['last_updated']); // 新しい項目のバインド
                    $updateStmt->bindParam(':user_id', $data['userId']);
                    $updateStmt->execute();
                } else {
                    logMessage("INSERT開始");
                    // レコードが存在しない場合はINSERT文を実行
                    $insertStmt = $this->pdo->prepare("INSERT INTO TB_USER_INFO (user_id, sub_locality, locality, postal_code, administrative_area, sub_thoroughfare, build_name, sub_administrative_area, thoroughfare, latitude, longitude, fcm_token, last_updated) VALUES (:user_id, :sub_locality, :locality, :postal_code, :administrative_area, :sub_thoroughfare, :build_name, :sub_administrative_area, :thoroughfare, :latitude, :longitude, :fcm_token, :last_updated)");
                    $insertStmt->bindParam(':user_id', $data['userId']);
                    $insertStmt->bindParam(':sub_locality', $data['subLocality']);
                    $insertStmt->bindParam(':locality', $data['locality']);
                    $insertStmt->bindParam(':postal_code', str_replace("-", "", $data['postalCode']));
                    $insertStmt->bindParam(':administrative_area', $data['administrativeArea']);
                    $insertStmt->bindParam(':sub_thoroughfare', $data['subThoroughfare']);
                    $insertStmt->bindParam(':build_name', $data['buildName']);
                    $insertStmt->bindParam(':sub_administrative_area', $data['subAdministrativeArea']);
                    $insertStmt->bindParam(':thoroughfare', $data['thoroughfare']);
                    $insertStmt->bindParam(':latitude', $data['latitude']);
                    $insertStmt->bindParam(':longitude', $data['longitude']);
                    $insertStmt->bindParam(':fcm_token', $data['fcm_token']); // 新しい項目のバインド
                    $insertStmt->bindParam(':last_updated', $data['last_updated']); // 新しい項目のバインド
                    $insertStmt->execute();                    
                }
        
                // 成功した場合はレコードのIDを返すなどの処理を行うこともできます
                $response = [
                    'status' => STATUS_SUCCSESS,
                    'message' => ''
                ];

                // データベース接続をクローズ
                $this->pdo = null;
                //結果返却
                return $response;

            } catch (PDOException $e) {
                // エラーハンドリング
                throw $e;
            }
        }

        // 毎週用のクエリ
        public function execEveryWeeksQuery($param) {
            logMessage("開始: 毎週用のクエリ");
        
            $stmt = $this->pdo->prepare("SELECT id FROM TB_GARBAGE_INFO WHERE garbageType = :garbageType AND schedule = :schedule AND yobi = :yobi");
            $stmt->bindValue(':garbageType', $param['garbageType']);
            $stmt->bindValue(':schedule', $param["schedule"]);
            $stmt->bindValue(':yobi', $param["yobi"]);
            
            // ゴミID取得
            $stmt->execute();
            $id = $stmt->fetchColumn();
        
            if (!$id) {
                // IDが取得できなかった場合はINSERT処理を行う
                logMessage("IDが取得できなかったため、INSERT処理を実行します");
                $insertStmt = $this->pdo->prepare("INSERT INTO TB_GARBAGE_INFO (garbageType, schedule, yobi) VALUES (:garbageType, :schedule, :yobi)");
                $insertStmt->bindValue(':garbageType', $param["garbageType"]);
                $insertStmt->bindValue(':schedule', $param["schedule"]);
                $insertStmt->bindValue(':yobi', $param["yobi"]);
                $insertStmt->execute();
        
                // ゴミID再取得
                $stmt->execute();
                $id = $stmt->fetchColumn();
            }
        
            logMessage("実行結果: " . $id);
            // 結果を返す（0件の場合はINSERTが実行されたかどうかを示すフラグを返すなど）
            return $id;
        }
        
        
        public function execEveryOtherWeekQuery($param) {
            logMessage("開始: 隔週の処理");
        
            $date = $param['strDate'];
            $selectStmt = $this->pdo->prepare("SELECT id FROM TB_GARBAGE_INFO WHERE garbageType = :garbageType AND schedule = :schedule AND yobi = :yobi AND freqWeek = :freqWeek AND date = :date");
            $selectStmt->bindValue(':garbageType', $param["garbageType"]);
            $selectStmt->bindValue(':schedule', $param["schedule"]);
            $selectStmt->bindValue(':yobi', $param["yobi"]);
            $selectStmt->bindValue(':freqWeek', $param["freqWeek"]);
            $selectStmt->bindValue(':date', $date);
        

             // ゴミID取得
            $selectStmt->execute();
            $id = $selectStmt->fetchColumn();
        
            if (!$id) {
                // 0件の場合はINSERT処理を行う
                logMessage("0件のため、INSERT処理を実行します");
                $insertStmt = $this->pdo->prepare("INSERT INTO TB_GARBAGE_INFO (garbageType, schedule, freqWeek, yobi, date) VALUES (:garbageType, :schedule, :freqWeek, :yobi, :date)");
                $insertStmt->bindValue(':garbageType', $param["garbageType"]);
                $insertStmt->bindValue(':schedule', $param["schedule"]);
                $insertStmt->bindValue(':freqWeek', $param["freqWeek"]);
                $insertStmt->bindValue(':yobi', $param["yobi"]);
                $insertStmt->bindValue(':date', $date);
                $insertStmt->execute();
        
                // 再度実行してIDを取得する
                $selectStmt->execute();
                $id = $selectStmt->fetchColumn();
            }
            
            logMessage("実行結果:" . $id);
            // 結果を返す（0件の場合はINSERTが実行されたかどうかを示すフラグを返すなど）
            return $id;
        }
        
        
        //毎月用のクエリ実行
        public function execEveryMonthQuery($param){
            logMessage("開始:毎月用のクエリ実行");
        
            $stmt = $this->pdo->prepare("SELECT id FROM TB_GARBAGE_INFO WHERE garbageType = :garbageType AND schedule = :schedule AND day = :day");
            $stmt->bindValue(':garbageType', $param["garbageType"]);
            $stmt->bindValue(':schedule', $param["schedule"]);
            $stmt->bindValue(':day', $param["day"], PDO::PARAM_INT); // 第三引数に PDO::PARAM_INT を追加
          
            //ゴミID取得
            $stmt->execute();
            $id = $stmt->fetchColumn();

            if (!$id) {
                logMessage("0件のため、INSERT処理を実行します");
                // 0件の場合はINSERT処理を行う
                $insertStmt = $this->pdo->prepare("INSERT INTO TB_GARBAGE_INFO (garbageType, schedule, day) VALUES (:garbageType, :schedule, :day)");
                $insertStmt->bindValue(':garbageType', $param["garbageType"]);
                $insertStmt->bindValue(':schedule', $param["schedule"]);
                $insertStmt->bindValue(':day', $param["day"]);
                $insertStmt->execute();

                // 再度実行してIDを取得する
                $stmt->execute();
                $id = $stmt->fetchColumn();
            }
        
            logMessage("実行結果:" . $id);
            // 結果を返す（0件の場合はINSERTが実行されたかどうかを示すフラグを返すなど）
            return $id;
        }
        
        //第○×曜日
        public function execNumberOfYobiQuery($param){
            logMessage("開始:第○×曜日");
        
            $stmt = $this->pdo->prepare("SELECT id FROM TB_GARBAGE_INFO WHERE garbageType = :garbageType AND schedule = :schedule AND yobi = :yobi AND weekOfMonth = :weekOfMonth");
            $stmt->bindValue(':garbageType', $param["garbageType"]);
            $stmt->bindValue(':schedule', $param["schedule"]);
            $stmt->bindValue(':yobi', $param["yobi"]);
            $stmt->bindValue(':weekOfMonth', $param["weekOfMonth"]);
        
            //ゴミID取得
            $stmt->execute();
            $id = $stmt->fetchColumn();
        
            if ($id == 0) {
                logMessage("0件のため、INSERT処理を実行します");
                // 0件の場合はINSERT処理を行う
                $insertStmt = $this->pdo->prepare("INSERT INTO TB_GARBAGE_INFO (garbageType, schedule, yobi, weekOfMonth) VALUES (:garbageType, :schedule, :yobi, :weekOfMonth)");
                $insertStmt->bindValue(':garbageType', $param["garbageType"]);
                $insertStmt->bindValue(':schedule', $param["schedule"]);
                $insertStmt->bindValue(':yobi', $param["yobi"]);
                $insertStmt->bindValue(':weekOfMonth', $param["weekOfMonth"]);
                $insertStmt->execute();

                //ゴミID取得
                $stmt->execute();
                $id = $stmt->fetchColumn();
            }
        
            logMessage("実行結果:" . $id);
            // 結果を返す（0件の場合はINSERTが実行されたかどうかを示すフラグを返すなど）
            return $id;
        }

        //ゴミIDの配列を元にゴミグループに情報にselectinsert
        //グループIDを返却
        public function execGarbageGroupQuery($garbageTypes) {
            logMessage("開始：execGarbageGroupQuery：ゴミグループ処理");
        
            // ゴミタイプのプレースホルダーを生成
            $placeholders = implode(',', array_fill(0, count($garbageTypes), '?'));
        
            // クエリの準備（SELECT文）
            $selectQuery = "SELECT garbageGroupId
                            FROM TB_GARBAGE_GROUP
                            WHERE garbageId IN ($placeholders)
                            GROUP BY garbageGroupId
                            HAVING COUNT(garbageGroupId) = " . count($garbageTypes);
                    
            // プリペアドステートメントの作成（SELECT文）
            $selectStmt = $this->pdo->prepare($selectQuery);
        
            // ゴミタイプをプレースホルダーにバインド（SELECT文）
            foreach ($garbageTypes as $index => $garbageType) {
                $selectStmt->bindValue($index + 1, $garbageType);
            }
        
            // クエリの実行（SELECT文）
            $selectStmt->execute();
        
            // 結果の取得
            // $garbageGroupId = $selectStmt->fetchAll(PDO::FETCH_ASSOC);
            $garbageGroupId = $selectStmt->fetchColumn();
        
            if (empty($garbageGroupId)) {
                // garbageGroupIdが取得できなかった場合はINSERTを実行
                logMessage("garbageGroupIdが取得できなかったため、INSERT処理を実行します");

                logMessage("シーケンスインクリメント取得");
                //シーケンスインクリメント
                $strql_update = $this->pdo->prepare('UPDATE sequence_groupid SET id = LAST_INSERT_ID(id + 1)');
                $strql_update->execute(); 
        
                $selectStmt = $this->pdo->prepare("SELECT id FROM sequence_groupid");
                $selectStmt->execute();
                $garbageGroupId = $selectStmt->fetchColumn();
        
                //シーケンステーブルが０件だった場合の処理、レコード消さない限り入らない
                if (!$garbageGroupId) {
                    // シーケンステーブルからIDが取得できなかった場合、INSERTを実行して新しいIDを生成
                    $insertStmt = $this->pdo->prepare("INSERT INTO sequence_groupid DEFAULT VALUES");
                    $insertStmt->execute();
        
                    // 新しく生成されたIDを取得
                    $garbageGroupId = $this->pdo->lastInsertId();
                }
        
                // クエリの準備（INSERT文）
                $insertQuery = "INSERT INTO TB_GARBAGE_GROUP (garbageGroupId, garbageId) VALUES ";
        
                $insertValues = [];
                foreach ($garbageTypes as $garbageType) {
                    $insertValues[] = "('$garbageGroupId', '$garbageType')";
                }
        
                $insertQuery .= implode(',', $insertValues);
        
                // INSERT文の実行
                $insertStmt = $this->pdo->prepare($insertQuery);
                $insertStmt->execute();
            }
        
            //終了
            logMessage("終了：execGarbageGroupQuery");
            logMessage("グループID:".print_r($garbageGroupId, true));

            return $garbageGroupId;
        }

        //ゴミ情報→住所変換マスタ更新
        public function execGarbageConvArea($groupId, $userId, $garbageInfoName,$convNo)
        {
            logMessage("開始：execGarbageConvArea");
            logMessage("UserInfoを検索し、groupIdを更新");

            // UserInfoを検索し、groupIdを更新
            $query = "UPDATE TB_USER_INFO SET garbage_group_id = :groupId WHERE user_id = :userId";
            $stmt = $this->pdo->prepare($query);
            $stmt->bindParam(':groupId', $groupId, PDO::PARAM_STR);
            $stmt->bindParam(':userId', $userId, PDO::PARAM_STR);
            $stmt->execute();
        
            logMessage("UserInfoから情報を取得");
            // UserInfoから情報を取得
            $query = "SELECT postal_code, administrative_area, locality, thoroughfare, latitude, longitude FROM TB_USER_INFO WHERE user_id = :userId";
            $stmt = $this->pdo->prepare($query);
            $stmt->bindParam(':userId', $userId, PDO::PARAM_STR);
            $stmt->execute();
            $userInfo = $stmt->fetch(PDO::FETCH_ASSOC);

            logMessage($userId);
            logMessage($userInfo['postal_code'].$userInfo['administrative_area'].$userInfo['locality'].$userInfo['thoroughfare']);
        
            logMessage("TB_GARBAGE_AREA_CONVを検索①");
            logMessage($convNo.$groupId.$garbageInfoName);
            
            $query = "SELECT * FROM TB_GARBAGE_AREA_CONV WHERE No = :no AND garbageGroupId = :garbageGroupId AND garbageInfoName = :garbageInfoName";
            $stmt = $this->pdo->prepare($query);
            $stmt->bindParam(':no', $convNo);
            $stmt->bindParam(':garbageGroupId', $groupId);
            $stmt->bindParam(':garbageInfoName', $garbageInfoName);
            $stmt->execute();
            
            $rowCount = $stmt->rowCount();
            
            logMessage("検索件数".$rowCount);
            if ($rowCount > 0) {
                $row = $stmt->fetch(); // Fetch the row to get the usageCount value
                $usageCount = $row['usageCount'];
            
                $query = "UPDATE TB_GARBAGE_AREA_CONV SET usageCount = :newUsageCount WHERE No = :no AND garbageGroupId = :garbageGroupId AND garbageInfoName = :garbageInfoName";
                $stmt = $this->pdo->prepare($query);
                
                // Increment the usageCount value
                $newUsageCount = $usageCount + 1;
                
                $stmt->bindParam(':newUsageCount', $newUsageCount);
                $stmt->bindParam(':no', $convNo);
                $stmt->bindParam(':garbageGroupId', $groupId);
                $stmt->bindParam(':garbageInfoName', $garbageInfoName);
                $stmt->execute();
            }

            logMessage("TB_GARBAGE_AREA_CONVを検索②");
            // TB_GARBAGE_AREA_CONVを検索
            $query = "SELECT * FROM TB_GARBAGE_AREA_CONV WHERE postalCode = :postalCode AND administrativeArea = :administrativeArea AND locality = :locality AND thoroughfare = :thoroughfare AND garbageGroupId = :groupId AND garbageInfoName = :garbageInfoName";
            $stmt = $this->pdo->prepare($query);
            $stmt->bindParam(':postalCode', $userInfo['postal_code'], PDO::PARAM_STR);
            $stmt->bindParam(':administrativeArea', $userInfo['administrative_area'], PDO::PARAM_STR);
            $stmt->bindParam(':locality', $userInfo['locality'], PDO::PARAM_STR);
            $stmt->bindParam(':thoroughfare', $userInfo['thoroughfare'], PDO::PARAM_STR);
            $stmt->bindParam(':groupId', $groupId, PDO::PARAM_STR);
            $stmt->bindParam(':garbageInfoName', $garbageInfoName, PDO::PARAM_STR);
            $stmt->execute();
            $result = $stmt->fetch(PDO::FETCH_ASSOC);
        
            if ($result) {
                logMessage("検索結果が存在する場合はusageCountをインクリメントしてUpdate");
                // 検索結果が存在する場合はusageCountをインクリメントしてUpdate
                $usageCount = $result['usageCount'] + 1;
                $query = "UPDATE TB_GARBAGE_AREA_CONV SET usageCount = :usageCount WHERE No = :no";
                $stmt = $this->pdo->prepare($query);
                $stmt->bindParam(':usageCount', $usageCount, PDO::PARAM_INT);
                $stmt->bindParam(':no', $result['No'], PDO::PARAM_INT);
                $stmt->execute();
            } else {
                logMessage("検索結果が存在しない場合はINSERT");
                // 検索結果が存在しない場合はINSERT
                $query = "INSERT INTO TB_GARBAGE_AREA_CONV (postalCode, administrativeArea, locality, thoroughfare, garbageGroupId, garbageInfoName, latitude ,longitude) VALUES (:postalCode, :administrativeArea, :locality, :thoroughfare, :groupId, :garbageInfoName, :latitude ,:longitude)";
                $stmt = $this->pdo->prepare($query);
                $stmt->bindParam(':postalCode', $userInfo['postal_code'], PDO::PARAM_STR);
                $stmt->bindParam(':administrativeArea', $userInfo['administrative_area'], PDO::PARAM_STR);
                $stmt->bindParam(':locality', $userInfo['locality'], PDO::PARAM_STR);
                $stmt->bindParam(':thoroughfare', $userInfo['thoroughfare'], PDO::PARAM_STR);
                $stmt->bindParam(':groupId', $groupId, PDO::PARAM_STR);
                $stmt->bindParam(':garbageInfoName', $garbageInfoName, PDO::PARAM_STR);
                $stmt->bindParam(':latitude', $userInfo['latitude'], PDO::PARAM_STR);
                $stmt->bindParam(':longitude', $userInfo['longitude'], PDO::PARAM_STR);
                $stmt->execute();
            }
        }

        //最後に挿入された行のIDを取得
        public function getLastInsertId(){
            return $this->pdo->lastInsertId();
        }

        //コネクション閉じる
        public function closecon(){
            $this->pdo = null;
        }
    }





