# 🎓 Class Management System (CMS)

A professional, high-performance class management solution designed for educators. This system streamlines attendance, grading, and behavior tracking, featuring native integration with Google Classroom and standardized Excel reporting.

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

### 📊 Standardized Reporting
Professional `.xlsx` exports optimized for Thai administration:
- **TH Sarabun New** font integration (14pt)
- **Header Rotation:** 90° text rotation for vertical headers to fit more data per page
- **Unified Data Format:** Consistent First Name / Last Name separation across all report types

---

## 🛠️ Technical Stack

| Layer | Technology |
|---|---|
| **Frontend** | HTML5, CSS3 (Glassmorphism UI), Vanilla JavaScript |
| **Backend & DB** | Supabase (PostgreSQL) |
| **Cloud Integration** | Google Classroom API (REST) |
| **Libraries** | ExcelJS, Html5-QRCode, Chart.js, QRCode.js |

---

## 🚀 Installation & Setup

### 1. Database Configuration

Initialize your Supabase project with the following table structures:

| Table | Columns |
|---|---|
| `students` | `id` (PK), `first_name`, `last_name`, `classroom`, `seat_no`, `behavior_score`, `email` |
| `assignments` | `id` (PK), `name`, `subject`, `classroom`, `category`, `max_score`, `passing_score` |
| `grades` | `student_id`, `assignment_id`, `score`, `status`, `updated_at` |
| `attendance` | `student_id`, `attendance_date`, `subject`, `status`, `hours`, `remark` |

### 2. API Keys

Update your credentials in the main configuration file:

```javascript
const SUPABASE_URL = 'YOUR_SUPABASE_URL';
const SUPABASE_KEY = 'YOUR_SUPABASE_ANON_KEY';
const GOOGLE_CLIENT_ID = 'YOUR_GOOGLE_CLIENT_ID';
```

## 📋 Report Standards

Reports are generated in accordance with Thai academic documentation standards:

- **Identity Consistency:** First and Last names are separated into individual columns for easy sorting.
- **Space Optimization:** Row heights are set to `100px` for headers, utilizing `textRotation: 90` for date and assignment columns.
- **Typography:** Defaults to `TH Sarabun New`, the official standard for Thai government and academic use.

---

## 📄 License

This project is licensed under the **MIT License**.

**Developed by:** Arnut Klangprapun
