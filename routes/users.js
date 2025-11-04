module.exports = function (router) {
    var User = require('../models/user');
    var Task = require('../models/task');

    var usersRoute = router.route('/users');
    var userRoute = router.route('/users/:id');

    usersRoute.get(function (req, res) {
        try {
            var query = User.find();

            var whereParam = req.query.where || req.query.filter;
            if (whereParam) {
                try {
                    var whereObj = JSON.parse(whereParam);
                    query = User.find(whereObj);
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

            if (req.query.limit) {
                query = query.limit(parseInt(req.query.limit));
            }

            if (req.query.count === 'true') {
                query.countDocuments(function (err, count) {
                    if (err) {
                        return res.status(500).json({
                            message: "Internal Server Error",
                            data: "Error counting users"
                        });
                    }
                    return res.status(200).json({
                        message: "OK",
                        data: count
                    });
                });
                return;
            }

            query.exec(function (err, users) {
                if (err) {
                    return res.status(500).json({
                        message: "Internal Server Error",
                        data: "Error retrieving users"
                    });
                }
                return res.status(200).json({
                    message: "OK",
                    data: users
                });
            });
        } catch (err) {
            return res.status(500).json({
                message: "Internal Server Error",
                data: "Unexpected error occurred"
            });
        }
    });

    usersRoute.post(function (req, res) {
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: "Bad Request",
                data: "User must have a name and email"
            });
        }

        var userData = {
            name: req.body.name,
            email: req.body.email,
            pendingTasks: req.body.pendingTasks || [],
            dateCreated: req.body.dateCreated || new Date()
        };

        var user = new User(userData);
        user.save(function (err, savedUser) {
            if (err) {
                if (err.code === 11000 || err.message.includes('duplicate')) {
                    return res.status(400).json({
                        message: "Bad Request",
                        data: "A user with this email already exists"
                    });
                }
                return res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error creating user"
                });
            }

            if (userData.pendingTasks && userData.pendingTasks.length > 0) {
                updateTasksForUser(savedUser._id.toString(), savedUser.name, userData.pendingTasks, function (updateErr) {
                    if (updateErr) {
                        console.error("Error updating tasks for new user:", updateErr);
                    }
                    return res.status(201).json({
                        message: "Created",
                        data: savedUser
                    });
                });
            } else {
                return res.status(201).json({
                    message: "Created",
                    data: savedUser
                });
            }
        });
    });

    userRoute.get(function (req, res) {
        try {
            var query = User.findById(req.params.id);

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

            query.exec(function (err, user) {
                if (err) {
                    if (err.name === 'CastError') {
                        return res.status(404).json({
                            message: "Not Found",
                            data: "User not found"
                        });
                    }
                    return res.status(500).json({
                        message: "Internal Server Error",
                        data: "Error retrieving user"
                    });
                }
                if (!user) {
                    return res.status(404).json({
                        message: "Not Found",
                        data: "User not found"
                    });
                }
                return res.status(200).json({
                    message: "OK",
                    data: user
                });
            });
        } catch (err) {
            return res.status(404).json({
                message: "Not Found",
                data: "User not found"
            });
        }
    });

    userRoute.put(function (req, res) {
        if (!req.body.name || !req.body.email) {
            return res.status(400).json({
                message: "Bad Request",
                data: "User must have a name and email"
            });
        }

        User.findById(req.params.id, function (err, user) {
            if (err) {
                if (err.name === 'CastError') {
                    return res.status(404).json({
                        message: "Not Found",
                        data: "User not found"
                    });
                }
                return res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error retrieving user"
                });
            }
            if (!user) {
                return res.status(404).json({
                    message: "Not Found",
                    data: "User not found"
                });
            }

            if (req.body.email !== user.email) {
                User.findOne({ email: req.body.email }, function (findErr, existingUser) {
                    if (findErr) {
                        return res.status(500).json({
                            message: "Internal Server Error",
                            data: "Error checking email uniqueness"
                        });
                    }
                    if (existingUser) {
                        return res.status(400).json({
                            message: "Bad Request",
                            data: "A user with this email already exists"
                        });
                    }
                    performUserUpdate();
                });
            } else {
                performUserUpdate();
            }

            function performUserUpdate() {
                var oldPendingTasks = user.pendingTasks || [];
                var newPendingTasks = req.body.pendingTasks || [];

                var tasksToUnassign = oldPendingTasks.filter(function (taskId) {
                    return newPendingTasks.indexOf(taskId) === -1;
                });

                if (tasksToUnassign.length > 0) {
                    Task.updateMany(
                        { _id: { $in: tasksToUnassign } },
                        { assignedUser: "", assignedUserName: "unassigned" },
                        function (unassignErr) {
                            if (unassignErr) {
                                console.error("Error unassigning tasks:", unassignErr);
                            }
                        }
                    );
                }

                user.name = req.body.name;
                user.email = req.body.email;
                user.pendingTasks = newPendingTasks;
                if (req.body.dateCreated) {
                    user.dateCreated = req.body.dateCreated;
                }

                user.save(function (saveErr, updatedUser) {
                    if (saveErr) {
                        if (saveErr.code === 11000 || saveErr.message.includes('duplicate')) {
                            return res.status(400).json({
                                message: "Bad Request",
                                data: "A user with this email already exists"
                            });
                        }
                        return res.status(500).json({
                            message: "Internal Server Error",
                            data: "Error updating user"
                        });
                    }

                    if (newPendingTasks.length > 0) {
                        updateTasksForUser(updatedUser._id.toString(), updatedUser.name, newPendingTasks, function (updateErr) {
                            if (updateErr) {
                                if (updateErr.message && updateErr.message.includes("already assigned")) {
                                    return res.status(400).json({
                                        message: "Bad Request",
                                        data: "Some tasks are already assigned to other users"
                                    });
                                }
                                return res.status(500).json({
                                    message: "Internal Server Error",
                                    data: "Error updating task references"
                                });
                            }
                            return res.status(200).json({
                                message: "OK",
                                data: updatedUser
                            });
                        });
                    } else {
                        return res.status(200).json({
                            message: "OK",
                            data: updatedUser
                        });
                    }
                });
            }
        });
    });

    userRoute.delete(function (req, res) {
        User.findById(req.params.id, function (err, user) {
            if (err) {
                if (err.name === 'CastError') {
                    return res.status(404).json({
                        message: "Not Found",
                        data: "User not found"
                    });
                }
                return res.status(500).json({
                    message: "Internal Server Error",
                    data: "Error retrieving user"
                });
            }
            if (!user) {
                return res.status(404).json({
                    message: "Not Found",
                    data: "User not found"
                });
            }

            var pendingTasks = user.pendingTasks || [];
            if (pendingTasks.length > 0) {
                Task.updateMany(
                    { _id: { $in: pendingTasks } },
                    { assignedUser: "", assignedUserName: "unassigned" },
                    function (unassignErr) {
                        if (unassignErr) {
                            console.error("Error unassigning tasks:", unassignErr);
                        }
                    }
                );
            }

            User.findByIdAndDelete(req.params.id, function (deleteErr) {
                if (deleteErr) {
                    return res.status(500).json({
                        message: "Internal Server Error",
                        data: "Error deleting user"
                    });
                }
                return res.status(204).send();
            });
        });
    });

    function updateTasksForUser(userId, userName, taskIds, callback) {
        if (!taskIds || taskIds.length === 0) {
            return callback(null);
        }

        Task.find({ _id: { $in: taskIds } }, function (err, tasks) {
            if (err) {
                return callback(err);
            }

            var conflictingTasks = [];
            for (var i = 0; i < tasks.length; i++) {
                if (tasks[i].assignedUser && tasks[i].assignedUser !== "" && tasks[i].assignedUser !== userId) {
                    conflictingTasks.push(tasks[i]._id.toString());
                }
            }

            if (conflictingTasks.length > 0) {
                return callback(new Error("Some tasks are already assigned to other users"));
            }

            Task.updateMany(
                { _id: { $in: taskIds } },
                { assignedUser: userId, assignedUserName: userName },
                function (updateErr) {
                    if (updateErr) {
                        return callback(updateErr);
                    }
                    callback(null);
                }
            );
        });
    }

    return router;
}
