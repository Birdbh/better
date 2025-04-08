from flask import Flask, request, jsonify, render_template, g
from flask_cors import CORS # If running frontend/backend separately
import sqlite3
import json
import os

app = Flask(__name__, template_folder='templates', static_folder='static')
# CORS(app) # Enable CORS if needed (e.g., frontend on different port)
app.config['DATABASE'] = 'quiz_app.db'

# ---- Database Helper ----
def get_db():
    db = getattr(g, '_database', None)
    if db is None:
        db = g._database = sqlite3.connect(app.config['DATABASE'])
        db.row_factory = sqlite3.Row # Return rows as dictionary-like objects
    return db

@app.teardown_appcontext
def close_connection(exception):
    db = getattr(g, '_database', None)
    if db is not None:
        db.close()

# ---- Utility ----
def get_user_id(username):
    cursor = get_db().cursor()
    cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
    user = cursor.fetchone()
    return user['id'] if user else None

# ---- Routes ----

# Serve Login Page
@app.route('/login', methods=['GET'])
def login_page():
    return render_template('login.html')

# Serve Main Quiz Page (index.html)
@app.route('/', methods=['GET'])
def index():
    # Basic check if user cookie/header exists could be added here,
    # but frontend handles redirect based on localStorage for simplicity.
    return render_template('index.html')

# API: Handle Login/Registration
@app.route('/api/login', methods=['POST'])
def handle_login():
    data = request.get_json()
    if not data or 'username' not in data:
        return jsonify({'success': False, 'message': 'Username is required.'}), 400

    username = data['username'].strip()
    if not username:
         return jsonify({'success': False, 'message': 'Username cannot be empty.'}), 400

    db = get_db()
    cursor = db.cursor()
    message = "Logged in successfully." # Default message

    try:
        # Check if user exists
        cursor.execute('SELECT id FROM users WHERE username = ?', (username,))
        user = cursor.fetchone()

        if user:
            print(f"User '{username}' exists. Logging in.")
        else:
            # User does not exist, create new user (register)
            print(f"User '{username}' does not exist. Creating...")
            cursor.execute('INSERT INTO users (username) VALUES (?)', (username,))
            db.commit()
            message = "Registered and logged in successfully."
            print(f"User '{username}' created.")

        return jsonify({'success': True, 'message': message, 'username': username})

    except sqlite3.IntegrityError: # Should not happen with prior check, but good practice
         db.rollback()
         print(f"Error: Integrity constraint violated for username '{username}'.")
         return jsonify({'success': False, 'message': 'Username might already be taken (concurrent request?).'}), 409
    except sqlite3.Error as e:
        db.rollback()
        print(f"Database error during login/register for '{username}': {e}")
        return jsonify({'success': False, 'message': 'A database error occurred.'}), 500

# API: Get all questions (including options, needed by frontend)
@app.route('/api/questions', methods=['GET'])
def get_questions():
    # Fetch pre-loaded questions from JSON (simpler than DB for options)
    # Or fetch from DB if options were stored there
    try:
        with open('questions.json', 'r') as f:
            # Load the original JSON with options included
            questions_data = json.load(f)
        return jsonify(questions_data)
    except FileNotFoundError:
        print("Error: questions.json not found.")
        return jsonify({"error": "Questions data file not found."}), 500
    except json.JSONDecodeError:
        print("Error: Could not decode questions.json.")
        return jsonify({"error": "Invalid questions data format."}), 500


# API: Get user progress
@app.route('/api/progress/<username>', methods=['GET'])
def get_progress(username):
    user_id = get_user_id(username)
    if not user_id:
        return jsonify({'error': 'User not found'}), 404

    db = get_db()
    cursor = db.cursor()
    try:
        cursor.execute('''
            SELECT question_id, status FROM user_progress
            WHERE user_id = ?
        ''', (user_id,))
        progress_rows = cursor.fetchall()

        correct_ids = [row['question_id'] for row in progress_rows if row['status'] == 'correct']
        incorrect_ids = [row['question_id'] for row in progress_rows if row['status'] == 'incorrect']

        return jsonify({
            'correct_ids': correct_ids,
            'incorrect_ids': incorrect_ids
        })
    except sqlite3.Error as e:
        print(f"Database error fetching progress for user {user_id}: {e}")
        return jsonify({"error": "Failed to fetch progress"}), 500


# API: Record an answer
@app.route('/api/answer', methods=['POST'])
def record_answer_api():
    data = request.get_json()
    if not data or not all(k in data for k in ('username', 'question_id', 'is_correct')):
        return jsonify({'success': False, 'message': 'Missing required fields.'}), 400

    username = data['username']
    question_id = data['question_id']
    is_correct = data['is_correct']
    status = 'correct' if is_correct else 'incorrect'

    user_id = get_user_id(username)
    if not user_id:
        return jsonify({'success': False, 'message': 'User not found.'}), 404

    db = get_db()
    cursor = db.cursor()
    try:
        # Use INSERT OR REPLACE to update status if exists, or insert if new
        # Requires the PRIMARY KEY (user_id, question_id) to be defined on the table
        cursor.execute('''
            INSERT OR REPLACE INTO user_progress (user_id, question_id, status)
            VALUES (?, ?, ?)
        ''', (user_id, question_id, status))
        db.commit()
        print(f"Recorded answer for user {user_id}, question {question_id}: {status}")
        return jsonify({'success': True, 'message': 'Answer recorded.'})
    except sqlite3.Error as e:
        db.rollback()
        print(f"Database error recording answer for user {user_id}, question {question_id}: {e}")
        return jsonify({'success': False, 'message': 'Database error recording answer.'}), 500


if __name__ == '__main__':
    # Ensure database exists before running
    if not os.path.exists(app.config['DATABASE']):
        print("Database file not found. Please run init_db.py first.")
    else:
        # Set debug=True for development (auto-reloads)
        # Use host='0.0.0.0' to make accessible on your network
        app.run(debug=True, host='0.0.0.0', port=5000)