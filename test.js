import mysql from "mysql2/promise";
import { dbConfig } from "./db.config.js"; // 데이터베이스 설정 파일

// 데이터베이스에서 job_listings 데이터를 조회하는 함수
async function fetchJobListings() {
  let connection;

  try {
    // 데이터베이스 연결
    connection = await mysql.createConnection(dbConfig);

    // job_listings 테이블에서 데이터 조회 
    //*** 나중에 직군별 구분위한 여기에 where 조건 추가
    const [rows] = await connection.execute(`
      SELECT id, title, link, company, skills, type, date
      FROM job_listings
    `);

    // 데이터 출력
    

    // 스킬별 등장 횟수 집계
    const skillCounts = {};
    rows.forEach((row) => {
      if (row.skills) {
        const skillsArray = JSON.parse(row.skills);
        skillsArray.forEach((skill) => {
          skillCounts[skill] = (skillCounts[skill] || 0) + 1;
        });
      }
    });

    // 스킬별 카운트 출력
    console.log("\nSkill Counts:");
    Object.entries(skillCounts).forEach(([skill, count]) => {
      console.log(`  ${skill}: ${count}`);
    });
  } catch (error) {
    console.error("Error fetching job listings:", error);
  } finally {
    if (connection) {
      await connection.end(); // 데이터베이스 연결 종료
    }
  }
}

// 함수 실행
fetchJobListings();
