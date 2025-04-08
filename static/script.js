document.addEventListener('DOMContentLoaded', () => {
    // --- Constants ---
    const FEEDBACK_DELAY_MS = 2000;
    const SHORT_TEXT_LENGTH = 35;
    const TOOLTIP_OFFSET_X = 10;
    const TOOLTIP_OFFSET_Y = 15;

    // --- DOM Elements ---
    const questionTextElement = document.getElementById('question-text');
    const optionsContainerElement = document.getElementById('options-container');
    const feedbackElement = document.getElementById('feedback');
    const totalQuestionsElement = document.getElementById('total-questions');
    const questionContainerElement = document.getElementById('question-container');
    const completionMessageElement = document.getElementById('completion-message');
    const finalIncorrectElement = document.getElementById('final-incorrect'); // Only show incorrect attempts count now
    const incorrectListElement = document.getElementById('incorrect-list');
    const incorrectCountElement = document.getElementById('incorrect-count');
    const correctListElement = document.getElementById('correct-list');
    const correctCountElement = document.getElementById('correct-count');
    const tooltipElement = document.getElementById('tooltip');
    const logoutButton = document.getElementById('logout-button');
    const loggedInUserSpan = document.getElementById('logged-in-user');

    // --- State Variables ---
    let currentUsername = null; // Store the logged-in username
    let allQuestions = []; // Full data from backend {id, question, options, answer}
    let questionsToAsk = []; // Questions for the current session (filtered by progress)
    let currentQuestion = null;
    let correctlyAnsweredInfo = []; // { id, shortText, fullAnswer } - Populated from backend progress
    let incorrectlyAnsweredInfo = []; // { id, shortText } - Populated from backend progress
    let totalQuestionsCount = 0;
    let incorrectAttemptsInSession = 0; // Track incorrect clicks *in this session* for display

    // --- Utility Functions ---
    function shortenText(text, maxLength = SHORT_TEXT_LENGTH) {
        return text.length <= maxLength ? text : text.substring(0, maxLength).trim() + '...';
    }

    // --- Tooltip Functions (same as before) ---
    function showTooltip(event, type) {
        const listItem = event.target;
        const questionId = parseInt(listItem.dataset.id, 10);
        const questionData = allQuestions.find(q => q.id === questionId);
        if (!questionData) return;

        let tooltipContent = `<div class='font-semibold mb-1'>Q: ${questionData.question}</div>`;
        if (type === 'correct') {
            tooltipContent += `<div class='text-green-300'>A: ${questionData.answer}</div>`;
        }
        tooltipElement.innerHTML = tooltipContent;

        let x = event.pageX + TOOLTIP_OFFSET_X;
        let y = event.pageY + TOOLTIP_OFFSET_Y;
        const tooltipRect = tooltipElement.getBoundingClientRect();
        const bodyRect = document.body.getBoundingClientRect();
        if (x + tooltipRect.width > bodyRect.width) x = event.pageX - tooltipRect.width - TOOLTIP_OFFSET_X;
        if (y + tooltipRect.height > window.innerHeight + window.scrollY) y = event.pageY - tooltipRect.height - TOOLTIP_OFFSET_Y;
        if (x < 0) x = TOOLTIP_OFFSET_X;
        if (y < window.scrollY) y = window.scrollY + TOOLTIP_OFFSET_Y;

        tooltipElement.style.left = `${x}px`;
        tooltipElement.style.top = `${y}px`;
        tooltipElement.classList.remove('hidden');
    }
    function hideTooltip() {
        tooltipElement.classList.add('hidden');
        tooltipElement.innerHTML = '';
        tooltipElement.style.left = '-9999px';
        tooltipElement.style.top = '-9999px';
    }

    // --- Backend Interaction ---

    // Fetch all question data from backend
    async function fetchAllQuestions() {
        try {
            const response = await fetch('/api/questions'); // API endpoint
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            allQuestions = await response.json();
            if (!Array.isArray(allQuestions) || allQuestions.length === 0) {
                throw new Error('Invalid or empty questions data received from server.');
            }
            totalQuestionsCount = allQuestions.length;
            totalQuestionsElement.textContent = totalQuestionsCount;
        } catch (error) {
            console.error('Failed to fetch questions:', error);
            questionTextElement.textContent = 'Error loading questions data. Cannot proceed.';
            optionsContainerElement.innerHTML = ''; // Stop the quiz
            allQuestions = []; // Ensure it's empty on error
        }
    }

    // Fetch user progress from backend
    async function fetchUserProgress() {
        if (!currentUsername) return; // Should not happen if auth check passes
        try {
            const response = await fetch(`/api/progress/${currentUsername}`); // API endpoint
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const progress = await response.json(); // Expects { correct_ids: [], incorrect_ids: [] }

            // Reset local state based on fetched progress
            correctlyAnsweredInfo = [];
            incorrectlyAnsweredInfo = [];

            allQuestions.forEach(q => {
                const shortQText = shortenText(q.question);
                if (progress.correct_ids && progress.correct_ids.includes(q.id)) {
                    correctlyAnsweredInfo.push({ id: q.id, shortText: shortQText, fullAnswer: q.answer });
                } else if (progress.incorrect_ids && progress.incorrect_ids.includes(q.id)) {
                    // If it's marked as incorrect in DB, add to incorrect list
                    incorrectlyAnsweredInfo.push({ id: q.id, shortText: shortQText });
                }
            });

            updateCounters();
            updateSidebars();

        } catch (error) {
            console.error('Failed to fetch user progress:', error);
            // Decide how to handle - maybe proceed with no progress?
            questionTextElement.textContent = 'Error loading user progress. Starting fresh?';
            // Reset lists if fetch failed after questions loaded
            correctlyAnsweredInfo = [];
            incorrectlyAnsweredInfo = [];
            updateCounters();
            updateSidebars();
        }
    }

    // Send answer result to backend
    async function recordAnswer(questionId, isCorrect) {
        if (!currentUsername) return;
        try {
            await fetch('/api/answer', { // API endpoint
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    username: currentUsername,
                    question_id: questionId,
                    is_correct: isCorrect
                }),
            });
            // No need to wait for response unless checking for errors server-side
        } catch (error) {
            console.error('Failed to record answer:', error);
            // Maybe notify user? For simplicity, we just log it.
            feedbackElement.textContent += ' (Warning: Could not save progress)';
        }
    }

    // --- Quiz Logic ---

    async function initializeQuiz() {
        currentUsername = localStorage.getItem('quizAppUser');
        if (!currentUsername) {
            window.location.href = '/login'; // Redirect to login if not logged in
            return; // Stop execution
        }

        loggedInUserSpan.textContent = currentUsername; // Display logged-in user
        logoutButton.addEventListener('click', logout);

        // 1. Fetch all question definitions
        await fetchAllQuestions();
        if (allQuestions.length === 0) return; // Stop if questions failed to load

        // 2. Fetch the user's progress for these questions
        await fetchUserProgress();

        // 3. Prepare the questions for the current session
        prepareQuestionsToAsk();

        // 4. Start the quiz display
        hideTooltip();
        completionMessageElement.classList.add('hidden');
        questionContainerElement.classList.remove('hidden');
        displayNextQuestion();
    }

    // Filter questions based on fetched progress
    function prepareQuestionsToAsk() {
        const answeredCorrectlyIds = correctlyAnsweredInfo.map(q => q.id);
        // Ask questions that are NOT answered correctly yet.
        // Incorrectly answered questions ARE included here to be asked again.
        questionsToAsk = allQuestions.filter(q => !answeredCorrectlyIds.includes(q.id));
        incorrectAttemptsInSession = 0; // Reset session attempt counter
    }

    // Display next question (or completion)
    function displayNextQuestion() {
        feedbackElement.textContent = '';
        feedbackElement.className = 'mt-5 p-3 rounded-md text-lg font-semibold hidden'; // Reset feedback

        // Filter out any questions that might have been answered correctly *during this session*
        const answeredCorrectlyIds = correctlyAnsweredInfo.map(q => q.id);
        questionsToAsk = questionsToAsk.filter(q => !answeredCorrectlyIds.includes(q.id));


        if (questionsToAsk.length === 0) {
            // Check if *all* questions are in the correct list now
            if (correctlyAnsweredInfo.length === totalQuestionsCount) {
                showCompletionMessage();
            } else {
                // This state might occur if progress loading failed or there's a logic mismatch
                questionTextElement.textContent = "No more questions in current pool. Refresh or check console.";
                optionsContainerElement.innerHTML = '';
                console.warn("Reached end of questionsToAsk, but not all questions are correct.", {
                    correctCount: correctlyAnsweredInfo.length,
                    totalCount: totalQuestionsCount
                });
            }
            return;
        }


        const randomIndex = Math.floor(Math.random() * questionsToAsk.length);
        currentQuestion = questionsToAsk[randomIndex];

        questionTextElement.textContent = currentQuestion.question;
        optionsContainerElement.innerHTML = '';
        // Use options from the fetched allQuestions data
        const questionData = allQuestions.find(q => q.id === currentQuestion.id);
        if (!questionData || !questionData.options) {
            console.error("Could not find options for question:", currentQuestion);
            questionTextElement.textContent = "Error displaying options.";
            return;
        }

        questionData.options.forEach(option => {
            const button = document.createElement('button');
            button.className = "block w-full p-3 mb-3 bg-blue-500 hover:bg-blue-600 text-white border border-transparent rounded-md cursor-pointer text-left text-base transition duration-150 ease-in-out disabled:opacity-50 disabled:cursor-not-allowed";
            button.textContent = option;
            button.addEventListener('click', () => handleAnswer(option, button));
            optionsContainerElement.appendChild(button);
        });
    }

    // Handle selected answer
    function handleAnswer(selectedOption, selectedButton) {
        const optionButtons = optionsContainerElement.querySelectorAll('button');
        optionButtons.forEach(button => button.disabled = true);

        const correctAnswer = currentQuestion.answer;
        const isCorrect = selectedOption === correctAnswer;
        const questionId = currentQuestion.id;
        const shortQText = shortenText(currentQuestion.question);

        feedbackElement.classList.remove('hidden');
        let feedbackClasses = ['border', 'p-3', 'rounded-md', 'text-lg', 'font-semibold'];

        // --- Update Local UI State FIRST ---
        if (isCorrect) {
            feedbackElement.textContent = 'Correct!';
            feedbackClasses.push('bg-green-100', 'text-green-700', 'border-green-300');
            selectedButton.classList.replace('bg-blue-500', 'bg-green-600');
            selectedButton.classList.replace('hover:bg-blue-600', 'hover:bg-green-600');

            // Add to correct list locally if not already there
            if (!correctlyAnsweredInfo.some(q => q.id === questionId)) {
                correctlyAnsweredInfo.push({ id: questionId, shortText: shortQText, fullAnswer: correctAnswer });
            }
            // Remove from incorrect list locally if it was there
            const incorrectIndex = incorrectlyAnsweredInfo.findIndex(q => q.id === questionId);
            if (incorrectIndex > -1) {
                incorrectlyAnsweredInfo.splice(incorrectIndex, 1);
            }
            // Remove from questionsToAsk for this session
            questionsToAsk = questionsToAsk.filter(q => q.id !== questionId);

        } else {
            incorrectAttemptsInSession++; // Increment session counter
            feedbackElement.textContent = `Incorrect. Correct: ${correctAnswer}`;
            feedbackClasses.push('bg-red-100', 'text-red-700', 'border-red-300');
            selectedButton.classList.replace('bg-blue-500', 'bg-red-600');
            selectedButton.classList.replace('hover:bg-blue-600', 'hover:bg-red-600');

            optionButtons.forEach(button => {
                if (button.textContent === correctAnswer) {
                    button.classList.replace('bg-blue-500', 'bg-green-600');
                    button.classList.replace('hover:bg-blue-600', 'hover:bg-green-600');
                    button.classList.add('border-2', 'border-green-800');
                }
            });

            // Add to incorrect list locally if not already there
            if (!incorrectlyAnsweredInfo.some(q => q.id === questionId)) {
                incorrectlyAnsweredInfo.push({ id: questionId, shortText: shortQText });
            }
            // Question remains in questionsToAsk to be potentially asked again this session
        }

        feedbackElement.className = 'mt-5 ' + feedbackClasses.join(' ');
        updateCounters();
        updateSidebars();

        // --- Record Answer to Backend (async - doesn't block UI) ---
        recordAnswer(questionId, isCorrect);

        // --- Proceed to Next Question ---
        setTimeout(displayNextQuestion, FEEDBACK_DELAY_MS);
    }

    // Update counters based on local state
    function updateCounters() {
        correctCountElement.textContent = correctlyAnsweredInfo.length;
        incorrectCountElement.textContent = incorrectlyAnsweredInfo.length;
        // totalQuestionsElement updated once during fetchAllQuestions
    }

    // Update sidebars based on local state
    function updateSidebars() {
        // Correct Sidebar
        correctListElement.innerHTML = '';
        correctlyAnsweredInfo.sort((a, b) => a.id - b.id); // Optional sort
        correctlyAnsweredInfo.forEach(q => {
            const li = document.createElement('li');
            li.className = "p-2 bg-green-50 border border-green-200 rounded text-sm cursor-default hover:bg-green-100 transition duration-150 ease-in-out";
            li.textContent = q.shortText;
            li.dataset.id = q.id;
            li.addEventListener('mouseover', (e) => showTooltip(e, 'correct'));
            li.addEventListener('mouseout', hideTooltip);
            correctListElement.appendChild(li);
        });

        // Incorrect Sidebar
        incorrectListElement.innerHTML = '';
        incorrectlyAnsweredInfo.sort((a, b) => a.id - b.id); // Optional sort
        incorrectlyAnsweredInfo.forEach(q => {
            const li = document.createElement('li');
            li.className = "p-2 bg-red-50 border border-red-200 rounded text-sm cursor-default hover:bg-red-100 transition duration-150 ease-in-out";
            li.textContent = q.shortText;
            li.dataset.id = q.id;
            li.addEventListener('mouseover', (e) => showTooltip(e, 'incorrect'));
            li.addEventListener('mouseout', hideTooltip);
            incorrectListElement.appendChild(li);
        });
    }

    function showCompletionMessage() {
        questionContainerElement.classList.add('hidden');
        completionMessageElement.classList.remove('hidden');
        // Display incorrect attempts from *this session*
        finalIncorrectElement.textContent = incorrectAttemptsInSession;
        hideTooltip();
    }

    // Reset progress for the current user (called by restart button)
    window.restartQuizForUser = async () => {
        if (!currentUsername) return;
        console.log("Restarting quiz for user:", currentUsername);
        try {
            // Optional: Add a backend endpoint to clear progress if desired
            // For now, just re-initialize the frontend state like a fresh login
            completionMessageElement.classList.add('hidden');
            questionContainerElement.classList.remove('hidden');
            await fetchUserProgress(); // Re-fetch progress (might be empty if backend cleared)
            prepareQuestionsToAsk();   // Re-prepare based on potentially reset progress
            displayNextQuestion();     // Start displaying questions
        } catch (error) {
            console.error("Error restarting quiz:", error);
        }
    }

    // Logout function
    function logout() {
        localStorage.removeItem('quizAppUser');
        window.location.href = '/login'; // Redirect to login page
    }


    // --- Initial Load ---
    initializeQuiz(); // Start the process: check auth, load data, display

}); // End DOMContentLoaded