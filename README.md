# 🎓 Class Management System (CMS)
A professional, class management solution designed for educators. This system streamlines attendance, grading, and behavior tracking, featuring native integration with Google Classroom and standardized Excel reporting.

---

## ✨ Key Features

### 📋 Attendance Tracking
Record student presence by period with support for multi-hour sessions and custom remarks.

### 📝 Comprehensive Grading
Manage scores across all academic categories — Pre-midterm, Midterm, Post-midterm, and Final.

### ⭐ Behavior Points
Real-time merit/demerit system on a 0–15 point scale with instant database updates.

### 📷 QR Code Ecosystem
| Feature | Description |
|---|---|
| **Rapid Submission** | Students scan QR codes to instantly mark assignments as *"Checked"* |
| **Automated Attendance** | Scan student IDs for lightning-fast classroom entry |
| **ID Generation** | Bulk generate and print QR cards for entire classrooms |

### 🔗 Google Classroom Sync
One-click synchronization of rosters, assignments, and returned grades via OAuth2.

## 🛠️ Technical Stack

| Layer | Technology |
|---|---|
| **Frontend** | HTML5, CSS3 (Glassmorphism UI), Vanilla JavaScript |
| **Backend & DB** | Supabase (PostgreSQL) |
| **Build Tool** | Vite |
| **CI/CD** | GitHub Actions → GitHub Pages |
| **Cloud Integration** | Google Classroom API (REST) |
| **Libraries** | ExcelJS, Html5-QRCode, Chart.js, QRCode.js |

---

## 🚀 Installation & Setup

### 1. Clone the repository
```bash
git clone https://github.com/kpp-arnut/cms.git
cd cms
npm install
```

### 2. Environment Variables
Create a `.env` file in the root directory:
```env
VITE_SUPABASE_URL=https://xxxx.supabase.co
VITE_SUPABASE_KEY=your_supabase_anon_key
VITE_GOOGLE_CLIENT_ID=your_google_client_id.apps.googleusercontent.com
```

> ⚠️ Never commit `.env` to version control. It is listed in `.gitignore` by default.

### 3. Database Configuration
Initialize your Supabase project with the following table structures:

| Table | Columns |
|---|---|
| `students` | `id` (PK), `first_name`, `last_name`, `classroom`, `seat_no`, `behavior_score`, `email` |
| `assignments` | `id` (PK), `name`, `subject`, `classroom`, `category`, `max_score`, `passing_score` |
| `grades` | `student_id`, `assignment_id`, `score`, `status`, `updated_at` |
| `attendance` | `student_id`, `attendance_date`, `subject`, `status`, `hours`, `remark` |

### 4. Google Cloud Console
Add your deployment URL to **Authorized JavaScript Origins**:
```
http://localhost:5173
https://kpp-arnut.github.io
```

### 5. Run locally
```bash
npm run dev
```

---

## 🚢 Deployment

This project auto-deploys to **GitHub Pages** via GitHub Actions on every push to `master`.

Add the following **Repository Secrets** under Settings → Secrets and variables → Actions:

| Secret | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_KEY` | Your Supabase anon key |
| `VITE_GOOGLE_CLIENT_ID` | Your Google OAuth client ID |

---

## License
This project is licensed under the **MIT License**.

**Developed by:** Arnut Klangprapun
