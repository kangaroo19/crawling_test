import puppeteer from "puppeteer";
import mysql from "mysql2/promise";
import { dbConfig } from "./db.config.js";

(async () => {
  const basicURL = "https://www.jumpit.co.kr";

  // MySQL 연결
  const connection = await mysql.createConnection(dbConfig);

  // 테이블 생성 (존재하지 않을 시)
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS job_listings (
      id VARCHAR(255) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      link TEXT NOT NULL,
      company VARCHAR(255) NOT NULL,
      skills TEXT
    )
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS skills_frequency (
      skill_name VARCHAR(255) PRIMARY KEY,
      count INT DEFAULT 0,
      frequency DECIMAL(5,3) DEFAULT 0
    )
  `);

  // 브라우저 실행
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  // 페이지로 이동
  await page.goto(
    "https://www.jumpit.co.kr/positions?jobCategory=2&sort=rsp_rate"
  );

  // 페이지가 로드될 때까지 대기
  await page.waitForSelector(".fJjUyN");

  // 스크롤 내리면서 데이터 로드
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      let totalHeight = 0;
      const distance = 100;
      const timer = setInterval(() => {
        window.scrollBy(0, distance);
        totalHeight += distance;

        if (totalHeight >= document.body.scrollHeight) {
          clearInterval(timer);
          resolve();
        }
      }, 100);
    });
  });

  const jobListings = await page.evaluate(() => {
    const listings = Array.from(document.querySelectorAll("a[target='_self']"));

    return listings.map((listing) => {
      // 공고 정보 추출
      const title = listing.querySelector(
        ".position_card_info_title"
      ).innerText;
      const link = document.location.origin + listing.getAttribute("href");
      const company = listing.querySelector(
        ".sc-15ba67b8-2.ixzmqw span"
      ).innerText;
      const skills = Array.from(
        listing.querySelectorAll(".sc-15ba67b8-1.iFMgIl li")
      )
        .map((skill) => skill.innerText.trim().replace("· ", ""))
        .filter((skill) => skill);

      // 공고 ID 추출 (링크의 마지막 숫자 부분)
      const id = link.split("/").pop();

      return { id, title, link, company, skills };
    });
  });

  // job_listings 업데이트 & skills_frequency 업데이트
  for (const job of jobListings) {
    const { id, title, link, company, skills } = job;
    const skillsString = skills.join(", ");

    // job_listings에 데이터 삽입 (이미 존재하는 경우 업데이트)
    await connection.execute(
      `
      INSERT INTO job_listings (id, title, link, company, skills)
      VALUES (?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE title = VALUES(title), link = VALUES(link), company = VALUES(company), skills = VALUES(skills)
    `,
      [id, title, link, company, skillsString]
    );

    // skills_frequency 테이블에 각 기술의 빈도 업데이트
    for (const skill of skills) {
      await connection.execute(
        `
        INSERT INTO skills_frequency (skill_name, count)
        VALUES (?, 1)
        ON DUPLICATE KEY UPDATE count = count + 1
      `,
        [skill]
      );
    }
  }

  // 전체 기술의 총 빈도수를 구하기
  const [totalCountRow] = await connection.execute(`
    SELECT SUM(count) as total_count FROM skills_frequency
  `);
  const totalCount = totalCountRow[0].total_count;

  // 각 기술의 백분율을 계산하여 frequency 필드에 업데이트
  await connection.execute(
    `
    UPDATE skills_frequency
    SET frequency = ROUND((count / ?) * 100, 3)
  `,
    [totalCount]
  );

  console.log("데이터베이스 업데이트 및 빈도 계산 완료");

  // 브라우저 종료 및 DB 연결 종료
  await browser.close();
  await connection.end();
})();
                                                                  