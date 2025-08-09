# FleetMan - Fleet Management System

A simple fleet management application for tracking cars, drivers, and assignments.

## Features

- **User Authentication**: Login/Registration with JWT tokens
- **Role-based Access**: Admin and regular user roles
- **Car Management**: Add, view, and manage vehicle fleet
- **Driver Management**: Track driver information and assignments  
- **Assignment Tracking**: Assign cars to drivers with history
- **Dashboard**: Overview statistics and current status

## Prerequisites

- Node.js (version 14 or higher)
- PostgreSQL database
- npm or yarn package manager

## Installation

1. Clone the repository:
```bash
git clone <repository-url>
cd fleetman
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
```bash
cp .env.example .env
```

Edit `.env` file with your configuration:
```env
DATABASE_URL=postgresql://username:password@localhost:5432/fleetman
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
PORT=3000
NODE_ENV=development
```

4. Set up the database:
```bash
# Connect to PostgreSQL and create database
createdb fleetman

# Run migrations
psql -d fleetman -f db/migrate.sql

# Optional: Add seed data
psql -d fleetman -f db/seed.sql
```

## Usage

1. Start the server:
```bash
npm start
```

2. Open your browser and navigate to:
```
http://localhost:3000
```

3. Default admin credentials (if you ran seed.sql):
   - Username: `billi`
   - Password: `123` (Note: This is from the bcrypt hash in seed.sql)

## API Endpoints

### Authentication
- `POST /api/auth/login` - User login
- `POST /api/auth/register` - User registration

### Dashboard
- `GET /api/health` - Health check
- `GET /api/stats` - Dashboard statistics (requires auth)

### Users (Admin only)
- `GET /api/users` - List all users
- `POST /api/users` - Create new user
- `DELETE /api/users/:id` - Delete user

### Cars
- `GET /api/cars` - List all cars
- `POST /api/cars` - Add new car (admin only)
- `DELETE /api/cars/:id` - Delete car (admin only)

### Drivers
- `GET /api/drivers` - List all drivers
- `POST /api/drivers` - Add new driver (admin only)
- `DELETE /api/drivers/:id` - Delete driver (admin only)

### Assignments
- `GET /api/assignments` - List assignment history
- `POST /api/assignments` - Create new assignment
- `PUT /api/assignments/:id` - End assignment
- `POST /api/assignments/unassign` - Unassign car from driver

## Development

The application runs in development mode by default with:
- Detailed error logging
- CORS enabled for all origins
- Database connection errors don't crash the app

## Security Notes

⚠️ **Important for Production:**

1. Change the JWT_SECRET to a strong, random string
2. Use proper database credentials and connection strings
3. Set up proper CORS origins in production
4. Use HTTPS in production
5. Set up proper database backups
6. Consider adding rate limiting for login attempts

## Database Schema

The application uses PostgreSQL with the following tables:
- `users` - User accounts and roles
- `cars` - Vehicle fleet information
- `drivers` - Driver information
- `assignments` - Car-to-driver assignment history

See `db/migrate.sql` for the complete schema.

## Troubleshooting

### Database Connection Issues
- Ensure PostgreSQL is running
- Check DATABASE_URL format: `postgresql://user:password@host:port/database`
- Verify database exists and user has proper permissions

### JWT Token Issues  
- Ensure JWT_SECRET is set in environment
- Check token expiration (default: 1 day)
- Verify Authorization header format: `Bearer <token>`

### Permission Issues
- Admin users can manage all resources
- Regular users can only view data and create assignments
- Check user role in database if permissions seem incorrect

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Test thoroughly
5. Submit a pull request

## License

This project is licensed under the MIT License.