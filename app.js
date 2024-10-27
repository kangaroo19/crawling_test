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

  // job_listings 테이블 생성 로직
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS job_listings (
      id VARCHAR(255),
      title VARCHAR(255) NOT NULL,
      link TEXT NOT NULL,
      company VARCHAR(255) NOT NULL,
      skills TEXT,
      type VARCHAR(50),
      date DATE NOT NULL,
      PRIMARY KEY (id, date)
    )
  `);

  // 오늘 날짜에 기반한 skills_frequency 테이블 이름 생성
  // const today = new Date().toISOString().slice(0, 10).replace(/-/g, "_");
  const today = "2024_10_26";

  // jobCategory와 오늘 날짜 조합으로 skills_frequency 테이블 생성
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS skills_frequency_${jobCategory}_${today} (
      skill_name VARCHAR(255) PRIMARY KEY,
      count INT DEFAULT 0,
      frequency DECIMAL(5, 3) DEFAULT 0,
      date DATE NOT NULL
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

  // const date = new Date().toISOString().slice(0, 10); // 오늘 날짜 (YYYY-MM-DD)
  const date = "2024-10-26";
  for (const job of jobListings) {
    const { id, title, link, company, skills } = job;
    const skillsString = skills.join(", ");
    const type = getCategoryType(jobCategory); // jobCategory 값에 따른 타입

    // job_listings에 데이터 저장
    await connection.execute(
      `
      INSERT INTO job_listings (id, title, link, company, skills, type, date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE title = VALUES(title), link = VALUES(link), company = VALUES(company), skills = VALUES(skills), type = VALUES(type), date = VALUES(date)
    `,
      [id, title, link, company, skillsString, type, date]
    );

    // skills_frequency 테이블에 각 기술 스킬 빈도 저장
    for (const skill of skills) {
      await connection.execute(
        `
        INSERT INTO skills_frequency_${jobCategory}_${today} (skill_name, count, date)
        VALUES (?, 1, ?)
        ON DUPLICATE KEY UPDATE count = count + 1, date = VALUES(date)
      `,
        [skill, date]
      );
    }
  }

  // 빈도 계산
  const [totalCountRow] = await connection.execute(`
    SELECT SUM(count) as total_count FROM skills_frequency_${jobCategory}_${today}
  `);
  const totalCount = totalCountRow[0].total_count;

  await connection.execute(
    `
    UPDATE skills_frequency_${jobCategory}_${today}
    SET frequency = ROUND((count / ?) * 100, 3)
  `,
    [totalCount]
  );

  await browser.close();
  await connection.end();

  res.send({ message: "크롤링 및 데이터 저장 완료" });
});

// 데이터 조회 API (특정 날짜 범위 조회)
app.get("/listings/:from/:to", async (req, res) => {
  const { from, to } = req.params;
  const connection = await connectToDatabase();

  const [rows] = await connection.execute(
    `SELECT * FROM job_listings WHERE date BETWEEN ? AND ?`,
    [from, to]
  );

  await connection.end();
  res.json(rows);
});

// 특정 기술의 빈도 조회 API (날짜 범위로)
app.get("/skills-frequency/:jobCategory/:date", async (req, res) => {
  const { jobCategory, date } = req.params;
  const formattedDate = date.replace(/-/g, "_");
  const connection = await connectToDatabase();

  const [rows] = await connection.execute(
    `SELECT * FROM skills_frequency_${jobCategory}_${formattedDate} ORDER BY count DESC`
  );

  await connection.end();
  res.json(rows);
});

// Helper: jobCategory 값을 타입으로 변환하는 함수
function getCategoryType(jobCategory) {
  switch (String(jobCategory)) {
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

// 서버 실행
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
