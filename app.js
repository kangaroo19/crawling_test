import express from "express";
import mysql from "mysql2/promise";
import puppeteer from "puppeteer";
import { dbConfig } from "./db.config.js";

const app = express();
const PORT = 3000;

app.use(express.json());

// MySQL 연결
const connectToDatabase = async () => {
  const connection = await mysql.createConnection(dbConfig);
  return connection;
};

// 크롤링 후 데이터 저장 API
app.post("/crawl", async (req, res) => {
  const { jobCategory } = req.body;

  if (!jobCategory) {
    return res.status(400).send({ error: "jobCategory is required" });
  }

  const connection = await connectToDatabase();

  // Today's date for tracking
  const crawlDate = new Date().toISOString().split("T")[0];

  // Create tables with the new date field
  await connection.execute(`
    CREATE TABLE IF NOT EXISTS job_listings (
      id VARCHAR(255) PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      link TEXT NOT NULL,
      company VARCHAR(255) NOT NULL,
      skills TEXT,
      type VARCHAR(50),
      crawl_date DATE NOT NULL
    )
  `);

  await connection.execute(`
    CREATE TABLE IF NOT EXISTS skills_frequency_${jobCategory} (
      skill_name VARCHAR(255) PRIMARY KEY,
      count INT DEFAULT 0,
      frequency DECIMAL(5, 3) DEFAULT 0,
      crawl_date DATE NOT NULL
    )
  `);

  // Puppeteer를 이용한 크롤링
  const browser = await puppeteer.launch({ headless: false });
  const page = await browser.newPage();
  await page.goto(
    `https://www.jumpit.co.kr/positions?jobCategory=${jobCategory}&sort=rsp_rate`
  );
  await page.waitForSelector(".fJjUyN");

  // 스크롤 내리기
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
    const type = getCategoryType(jobCategory);

    // Insert job listings with today's date
    await connection.execute(
      `
      INSERT INTO job_listings (id, title, link, company, skills, type, crawl_date)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON DUPLICATE KEY UPDATE title = VALUES(title), link = VALUES(link), company = VALUES(company), skills = VALUES(skills), type = VALUES(type), crawl_date = ?
    `,
      [id, title, link, company, skillsString, type, crawlDate, crawlDate]
    );

    // Insert skills frequency with today's date
    for (const skill of skills) {
      await connection.execute(
        `
        INSERT INTO skills_frequency_${jobCategory} (skill_name, count, crawl_date)
        VALUES (?, 1, ?)
        ON DUPLICATE KEY UPDATE count = count + 1, crawl_date = ?
      `,
        [skill, crawlDate, crawlDate]
      );
    }
  }

  const [totalCountRow] = await connection.execute(
    `
    SELECT SUM(count) as total_count FROM skills_frequency_${jobCategory}
    WHERE crawl_date = ?
  `,
    [crawlDate]
  );
  const totalCount = totalCountRow[0].total_count;

  await connection.execute(
    `
    UPDATE skills_frequency_${jobCategory}
    SET frequency = ROUND((count / ?) * 100, 3)
    WHERE crawl_date = ?
  `,
    [totalCount, crawlDate]
  );

  await browser.close();
  await connection.end();

  res.send({ message: "크롤링 및 데이터 저장 완료" });
});

// Helper functions
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

// 서버 실행
app.listen(PORT, () => {
  console.log(`서버가 포트 ${PORT}에서 실행 중입니다.`);
});
