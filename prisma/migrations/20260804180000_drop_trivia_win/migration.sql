-- TriviaWin chưa bao giờ được ghi: không có code nào tham chiếu tới nó, và bảng
-- rỗng (0 row) trên DB production. Hạn mức trivia mỗi ngày được đếm qua
-- ScoinTransaction (source = 'trivia:win'), không qua bảng này.
DROP TABLE IF EXISTS "TriviaWin";
