import express from "express";
import mysql from "mysql2/promise";
import puppeteer from "puppeteer";
import { dbConfig } from "./db.config.js";

const app = express();
const PORT = 3000;

// JSON 파싱을 위한 미들웨어
app.use(express.json());

// MySQL 연결
const connectToDatabase = async () => {
  const connection = await mysql.createConnection(dbConfig);
  return connection;
};

// 크롤링 후 데이터 저장 API
app.post("/crawl", async (req, res) => {
  const { jobCategory } = req.body; // jobCategory: 1, 2, 4, 16 등의 값을 받음

  if (!jobCategory) {
    return res.status(400).send({ error: "jobCategory is required" });
  }

  const connection = await connectToDatabase();

  // job_listings 테이블과 skills_frequency_{category} 테이블을 위한 테이블 생성 로직
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS job_listings (
      id VARCHAR(255) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      link TEXT NOT NULL,
      company VARCHAR(255) NOT NULL,
      skills TEXT,
      type VARCHAR(50)
    )
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS skills_frequency_${jobCategory} (
      skill_name VARCHAR(255) PRIMARY KEY,
      count INT DEFAULT 0,
      frequency DECIMAL(5, 3) DEFAULT 0
    )
  `);

  // Puppeteer를 이용한 크롤링 로직
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();

  await page.goto(
    `https://www.jumpit.co.kr/positions?jobCategory=${jobCategory}&sort=rsp_rate`
  );
  await page.waitForSelector(".fJjUyN");

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

      const id = link.split("/").pop();

      return { id, title, link, company, skills };
    });
  });

  for (const job of jobListings) {
    const { id, title, link, company, skills } = job;
    const skillsString = skills.join(", ");
    const type = getCategoryType(jobCategory); // jobCategory 값에 따른 타입

    await connection.execute(
      `
      INSERT INTO job_listings_jumpit (id, title, link, company, skills, type)
      VALUES (?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE title = VALUES(title), link = VALUES(link), company = VALUES(company), skills = VALUES(skills), type = VALUES(type)
    `,
      [id, title, link, company, skillsString, type]
    );

    for (const skill of skills) {
      await connection.execute(
        `
        INSERT INTO skills_frequency_${jobCategory} (skill_name, count)
        VALUES (?, 1)
        ON DUPLICATE KEY UPDATE count = count + 1
      `,
        [skill]
      );
    }
  }

  const [totalCountRow] = await connection.execute(`
    SELECT SUM(count) as total_count FROM skills_frequency_${jobCategory}
  `);
  const totalCount = totalCountRow[0].total_count;

  await connection.execute(
    `
    UPDATE skills_frequency_${jobCategory}
    SET frequency = ROUND((count / ?) * 100, 3)
  `,
    [totalCount]
  );

  await browser.close();
  await connection.end();

  res.send({ message: "크롤링 및 데이터 저장 완료" });
});

// 데이터 조회 API
app.get("/listings", async (req, res) => {
  const connection = await connectToDatabase();

  const [rows] = await connection.execute(`
    SELECT * FROM job_listings_jumpit
  `);

  await connection.end();
  res.json(rows);
});

// 특정 기술의 빈도 조회 API
app.get("/skills-frequency/:jobCategory", async (req, res) => {
  const { jobCategory } = req.params;
  const connection = await connectToDatabase();

  const [rows] = await connection.execute(`
    SELECT * FROM skills_frequency_${getCategoryType_En(
      jobCategory
    )} ORDER BY count DESC;
  `);

  await connection.end();
  res.json(rows);
});

// Helper: jobCategory 값을 타입으로 변환하는 함수
function getCategoryType(jobCategory) {
  switch (jobCategory) {
    case "1":
      return "백엔드";
    case "2":
      return "프론트엔드";
    case "4":
      return "안드로이드";
    case "16":
      return "iOS";
    default:
      return "기타";
  }
}
function getCategoryType_En(jobCategory) {
  switch (jobCategory) {
    case "1":
      return "backend";
    case "2":
      return "frontend";
    case "4":
      return "android";
    case "16":
      return "ios";
    default:
      return "기타";
  }
}
// 서버 실행
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
