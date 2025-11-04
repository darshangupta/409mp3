module.exports = function (router) {
    var User = require('../models/user');
    var Task = require('../models/task');

    var tasksRoute = router.route('/tasks');
    var taskRoute = router.route('/tasks/:id');

    tasksRoute.get(function (req, res) {
        try {
            var query = Task.find();

            var whereParam = req.query.where || req.query.filter;
            if (whereParam) {
                try {
                    var whereObj = JSON.parse(whereParam);
                    query = Task.find(whereObj);
                } catch (e) {
                    return res.status(400).json({
                        message: "Bad Request",
                        data: "Invalid where/filter parameter format"
                    });
                }
            }

            if (req.query.sort) {
                try {
                    var sortObj = JSON.parse(req.query.sort);
                    query = query.sort(sortObj);
                } catch (e) {
                    return res.status(400).json({
                        message: "Bad Request",
                        data: "Invalid sort parameter format"
                    });
                }
            }

            if (req.query.select) {
                try {
                    var selectObj = JSON.parse(req.query.select);
                    query = query.select(selectObj);
                } catch (e) {
                    return res.status(400).json({
                        message: "Bad Request",
                        data: "Invalid select parameter format"
                    });
                }
            }

            if (req.query.skip) {
                query = query.skip(parseInt(req.query.skip));
            }

            var limit = 100;
            if (req.query.limit) {
                limit = parseInt(req.query.limit);
            }
            query = query.limit(limit);

            if (req.query.count === 'true') {
                query.countDocuments(function (err, count) {
                    if (err) {
                        return res.status(500).json({
                            message: "Internal Server Error",
                            data: "Error counting tasks"
                        });
                    }
                    return res.status(200).json({
                        message: "OK",
                        data: count
                    });
                });
                return;
            }

            query.exec(function (err, tasks) {
                if (err) {
                    return res.status(500).json({
                        message: "Internal Server Error",
                        data: "Error retrieving tasks"
                    });
                }
                return res.status(200).json({
                    message: "OK",
                    data: tasks
                });
            });
        } catch (err) {
            return res.status(500).json({
                message: "Internal Server Error",
                data: "Unexpected error occurred"
            });
        }
    });

    tasksRoute.post(function (req, res) {
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: "Bad Request",
                data: "Task must have a name and deadline"
            });
        }

        var taskData = {
            name: req.body.name,
            description: req.body.description || "",
            deadline: req.body.deadline,
            completed: req.body.completed !== undefined ? req.body.completed : false,
            assignedUser: req.body.assignedUser || "",
            assignedUserName: "unassigned",
            dateCreated: req.body.dateCreated || new Date()
        };

        if (taskData.assignedUser && taskData.assignedUser !== "") {
            User.findById(taskData.assignedUser, function (userErr, user) {
                if (userErr || !user) {
                    return res.status(400).json({
                        message: "Bad Request",
                        data: "Assigned user not found"
                    });
                }

                taskData.assignedUserName = user.name;
                createTask();
            });
        } else {
            createTask();
        }

        function createTask() {
            var task = new Task(taskData);
            task.save(function (err, savedTask) {
                if (err) {
                    return res.status(500).json({
                        message: "Internal Server Error",
                        data: "Error creating task"
                    });
                }

                if (taskData.assignedUser && taskData.assignedUser !== "" && !taskData.completed) {
                    User.findById(taskData.assignedUser, function (userErr, user) {
                        if (!userErr && user) {
                            var pendingTasks = user.pendingTasks || [];
                            var taskIdStr = savedTask._id.toString();
                            if (pendingTasks.indexOf(taskIdStr) === -1) {
                                pendingTasks.push(taskIdStr);
                                user.pendingTasks = pendingTasks;
                                user.save(function (saveErr) {
                                    if (saveErr) {
                                        console.error("Error updating user's pendingTasks:", saveErr);
                                    }
                                });
                            }
                        }
                    });
                }

                return res.status(201).json({
                    message: "Created",
                    data: savedTask
                });
            });
        }
    });

    taskRoute.get(function (req, res) {
        try {
            var query = Task.findById(req.params.id);

            if (req.query.select) {
                try {
                    var selectObj = JSON.parse(req.query.select);
                    query = query.select(selectObj);
                } catch (e) {
                    return res.status(400).json({
                        message: "Bad Request",
                        data: "Invalid select parameter format"
                    });
                }
            }

            query.exec(function (err, task) {
                if (err) {
                    if (err.name === 'CastError') {
                        return res.status(404).json({
                            message: "Not Found",
                            data: "Task not found"
                        });
                    }
                    return res.status(500).json({
                        message: "Internal Server Error",
                        data: "Error retrieving task"
                    });
                }
                if (!task) {
                    return res.status(404).json({
                        message: "Not Found",
                        data: "Task not found"
                    });
                }
                return res.status(200).json({
                    message: "OK",
                    data: task
                });
            });
        } catch (err) {
            return res.status(404).json({
                message: "Not Found",
                data: "Task not found"
            });
        }
    });

    taskRoute.put(function (req, res) {
        if (!req.body.name || !req.body.deadline) {
            return res.status(400).json({
                message: "Bad Request",
                data: "Task must have a name and deadline"
            });
        }

        Task.findById(req.params.id, function (err, task) {
            if (err) {
                if (err.name === 'CastError') {
                    return res.status(404).json({
                        message: "Not Found",
                        data: "Task not found"
                    });
                }
                return res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error retrieving task"
                });
            }
            if (!task) {
                return res.status(404).json({
                    message: "Not Found",
                    data: "Task not found"
                });
            }

            var oldAssignedUser = task.assignedUser || "";
            var oldAssignedUserName = task.assignedUserName || "unassigned";
            var newAssignedUser = req.body.assignedUser || "";
            var newAssignedUserName = req.body.assignedUserName || "unassigned";
            var newCompleted = req.body.completed !== undefined ? req.body.completed : false;
            var taskIdStr = task._id.toString();

            task.name = req.body.name;
            task.description = req.body.description !== undefined ? req.body.description : "";
            task.deadline = req.body.deadline;
            task.completed = newCompleted;
            task.assignedUser = newAssignedUser;
            task.assignedUserName = newAssignedUserName;
            if (req.body.dateCreated) {
                task.dateCreated = req.body.dateCreated;
            }

            var updatePromises = [];

            var wasCompleted = task.completed || false;
            if (newCompleted && !wasCompleted && newAssignedUser && newAssignedUser !== "") {
                updatePromises.push(new Promise(function (resolve) {
                    User.findById(newAssignedUser, function (userErr, user) {
                        if (!userErr && user) {
                            var pendingTasks = user.pendingTasks || [];
                            var index = pendingTasks.indexOf(taskIdStr);
                            if (index !== -1) {
                                pendingTasks.splice(index, 1);
                                user.pendingTasks = pendingTasks;
                                user.save(function (saveErr) {
                                    if (saveErr) {
                                        console.error("Error removing completed task from user:", saveErr);
                                    }
                                    resolve();
                                });
                            } else {
                                resolve();
                            }
                        } else {
                            resolve();
                        }
                    });
                }));
            }

            if (oldAssignedUser && oldAssignedUser !== "" && oldAssignedUser !== newAssignedUser) {
                updatePromises.push(new Promise(function (resolve) {
                    User.findById(oldAssignedUser, function (userErr, oldUser) {
                        if (!userErr && oldUser) {
                            var pendingTasks = oldUser.pendingTasks || [];
                            var index = pendingTasks.indexOf(taskIdStr);
                            if (index !== -1) {
                                pendingTasks.splice(index, 1);
                                oldUser.pendingTasks = pendingTasks;
                                oldUser.save(function (saveErr) {
                                    if (saveErr) {
                                        console.error("Error removing task from old user:", saveErr);
                                    }
                                    resolve();
                                });
                            } else {
                                resolve();
                            }
                        } else {
                            resolve();
                        }
                    });
                }));
            }

            if (newAssignedUser && newAssignedUser !== "" && !newCompleted) {
                updatePromises.push(new Promise(function (resolve, reject) {
                    User.findById(newAssignedUser, function (userErr, newUser) {
                        if (userErr || !newUser) {
                            return reject(new Error("Assigned user not found"));
                        }

                        User.findOne({ 
                            _id: { $ne: newAssignedUser },
                            pendingTasks: taskIdStr 
                        }, function (conflictErr, conflictUser) {
                            if (conflictErr) {
                                return reject(conflictErr);
                            }
                            if (conflictUser) {
                                return reject(new Error("Task is already assigned to another user"));
                            }

                            var pendingTasks = newUser.pendingTasks || [];
                            if (pendingTasks.indexOf(taskIdStr) === -1) {
                                pendingTasks.push(taskIdStr);
                                newUser.pendingTasks = pendingTasks;
                                newUser.save(function (saveErr) {
                                    if (saveErr) {
                                        return reject(saveErr);
                                    }
                                    resolve();
                                });
                            } else {
                                resolve();
                            }
                        });
                    });
                }));
            }

            Promise.all(updatePromises).then(function () {
                task.save(function (saveErr, updatedTask) {
                    if (saveErr) {
                        return res.status(500).json({
                            message: "Internal Server Error",
                            data: "Error updating task"
                        });
                    }
                    return res.status(200).json({
                        message: "OK",
                        data: updatedTask
                    });
                });
            }).catch(function (updateErr) {
                if (updateErr.message && updateErr.message.includes("already assigned")) {
                    return res.status(400).json({
                        message: "Bad Request",
                        data: "The task is already assigned to another user"
                    });
                }
                return res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error updating task references"
                });
            });
        });
    });

    taskRoute.delete(function (req, res) {
        Task.findById(req.params.id, function (err, task) {
            if (err) {
                if (err.name === 'CastError') {
                    return res.status(404).json({
                        message: "Not Found",
                        data: "Task not found"
                    });
                }
                return res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error retrieving task"
                });
            }
            if (!task) {
                return res.status(404).json({
                    message: "Not Found",
                    data: "Task not found"
                });
            }

            var assignedUser = task.assignedUser || "";
            var taskIdStr = task._id.toString();

            if (assignedUser && assignedUser !== "") {
                User.findById(assignedUser, function (userErr, user) {
                    if (!userErr && user) {
                        var pendingTasks = user.pendingTasks || [];
                        var index = pendingTasks.indexOf(taskIdStr);
                        if (index !== -1) {
                            pendingTasks.splice(index, 1);
                            user.pendingTasks = pendingTasks;
                            user.save(function (saveErr) {
                                if (saveErr) {
                                    console.error("Error removing task from user:", saveErr);
                                }
                            });
                        }
                    }
                });
            }

            Task.findByIdAndDelete(req.params.id, function (deleteErr) {
                if (deleteErr) {
                    return res.status(500).json({
                        message: "Internal Server Error",
                        data: "Error deleting task"
                    });
                }
                return res.status(204).send();
            });
        });
    });

    return router;
}
