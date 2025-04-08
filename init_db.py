import sqlite3
import json

DATABASE = 'quiz_app.db'

def init_db():
    print("Initializing database...")
    try:
        conn = sqlite3.connect(DATABASE)
        cursor = conn.cursor()

        # Drop tables if they exist (for easy re-initialization during development)
        print("Dropping existing tables (if any)...")
        cursor.execute('DROP TABLE IF EXISTS user_progress')
        cursor.execute('DROP TABLE IF EXISTS users')
        cursor.execute('DROP TABLE IF EXISTS questions') # Store questions in DB too

        # Create users table
        print("Creating users table...")
        cursor.execute('''
            CREATE TABLE users (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                username TEXT UNIQUE NOT NULL
            )
        ''')

        # Create questions table (optional but good practice)
        print("Creating questions table...")
        cursor.execute('''
            CREATE TABLE questions (
                id INTEGER PRIMARY KEY, -- Use the ID from JSON
                question TEXT NOT NULL,
                answer TEXT NOT NULL
                -- options could be stored as JSON text if needed,
                -- but we'll load from JSON file in app for simplicity now
            )
        ''')

        # Create user_progress table
        # Stores the status of each question for each user
        print("Creating user_progress table...")
        cursor.execute('''
            CREATE TABLE user_progress (
                user_id INTEGER NOT NULL,
                question_id INTEGER NOT NULL,
                status TEXT NOT NULL CHECK(status IN ('correct', 'incorrect')),
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users (id),
                FOREIGN KEY (question_id) REFERENCES questions (id),
                PRIMARY KEY (user_id, question_id) -- Ensures one status per user/question
            )
        ''')

        # Load questions from JSON and insert into questions table
        print("Loading questions from questions.json into database...")
        try:
            with open('questions.json', 'r') as f:
                questions_data = json.load(f)

            if not isinstance(questions_data, list):
                raise ValueError("questions.json should contain a list of questions.")

            for q in questions_data:
                if not all(k in q for k in ('id', 'question', 'answer')):
                     print(f"Skipping invalid question format: {q}")
                     continue
                cursor.execute('''
                    INSERT INTO questions (id, question, answer)
                    VALUES (?, ?, ?)
                ''', (q['id'], q['question'], q['answer']))
            print(f"Loaded {len(questions_data)} questions into DB.")

        except FileNotFoundError:
             print("Error: questions.json not found. Cannot populate questions table.")
        except json.JSONDecodeError:
             print("Error: Could not decode questions.json. Check its format.")
        except ValueError as e:
             print(f"Error processing questions.json: {e}")
        except sqlite3.Error as e:
            print(f"Database error during question insertion: {e}")


        conn.commit()
        print("Database initialized successfully.")

    except sqlite3.Error as e:
        print(f"An error occurred during database initialization: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == '__main__':
    init_db()